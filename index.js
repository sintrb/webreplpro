/*
	term.js
	Copyright (c) 2012-2013, Christopher Jeffrey (MIT License)
	Copyright (c) 2016, Paul Sokolovsky


*/
;
var term;
var editor;
var ws;
var connected = false;
var binary_state = 0;
var put_file_name = null;
var put_file_data = null;
var get_file_name = null;
var get_file_data = null;
var get_to_editor = false;

function throttle(method,delay){
	var timer=null;
	return function(){
		var context=this, args=arguments;
		clearTimeout(timer);
		timer=setTimeout(function(){
			method.apply(context,args);
		},delay);
	}
}

(function() {
	window.onload = function() {

		$(".when-connteted").attr("disabled","disabled");

		term = new Terminal({
			cols: 25,
			rows: 20,
			useStyle: true,
			screenKeys: true,
			cursorBlink: false
		});
		term.open(document.getElementById("term"));
		if (window.localStorage.wssrc)
			document.getElementById('url').value = window.localStorage.wssrc;
		if(window.localStorage.filename)
			document.getElementById('get_filename').value = window.localStorage.filename;

		// ace
		var ee = $("#editor");
		editor = ace.edit("editor");
		editor.session.setMode('ace/mode/python');
		editor.setTheme("ace/theme/chrome");

		var reseifuc = function(){
			var win = self;
			var sw = win.innerWidth-10;
			var sh = win.innerHeight - 150;
			var edk = 0.7;
			term.resize(Math.round(sw/12), Math.floor(sh*(1-edk)/12));
			// console.log(sw/7, sh*(1-edk)/12)

			$("#editor").width(sw);
			$("#editor").height(sh*edk);
		}
		window.addEventListener('resize', throttle(reseifuc, 100));
		reseifuc();
		ee.focus();
	};
}).call(this);
function button_click() {
	if (connected) {
		ws.close();
	} else {
		document.getElementById('url').disabled = true;
		document.getElementById('button').value = "Disconnect";
		connected = true;
		connect(document.getElementById('url').value);
	}
}
function prepare_for_connect() {
	document.getElementById('url').disabled = false;
	document.getElementById('button').value = "Connect";
}
function update_file_status(s) {
	document.getElementById('file-status').innerHTML = s;
}
function connect(url) {
	window.localStorage.wssrc = url;
	ws = new WebSocket(url);
	ws.binaryType = 'arraybuffer';
	ws.onopen = function() {
		term.removeAllListeners('data');
		term.on('data',
		function(data) {
			// Pasted data from clipboard will likely contain
			// LF as EOL chars.
			data = data.replace(/\n/g, "\r");
			ws.send(data);
		});
		term.on('title',function(title) {
			// document.title = title + " Pro";
		});
		term.focus();
		term.element.focus();
		term.write('\x1b[31mWelcome to MicroPython Pro!\x1b[m\r\n');
		$(".when-connteted").removeAttr("disabled");
		ws.onmessage = function(event) {
			if (event.data instanceof ArrayBuffer) {
				var data = new Uint8Array(event.data);
				switch (binary_state) {
				case 11:
					// first response for put
					if (decode_resp(data) == 0) {
						// send file data in chunks
						for (var offset = 0; offset < put_file_data.length; offset += 1024) {
							ws.send(put_file_data.slice(offset, offset + 1024));
						}
						binary_state = 12;
					}
					break;
				case 12:
					// final response for put
					if (decode_resp(data) == 0) {
						update_file_status('Sent ' + put_file_name + ', ' + put_file_data.length + ' bytes');
					} else {
						update_file_status('Failed sending ' + put_file_name);
					}
					binary_state = 0;
					break;
				case 21:
					// first response for get
					if (decode_resp(data) == 0) {
						binary_state = 22;
					}
					break;
				case 22:
					{
						// file data
						var sz = data[0] | (data[1] << 8);
						if (data.length == 2 + sz) {
							// we assume that the data comes in single chunks
							if (sz == 0) {
								// end of file
								binary_state = 23;
							} else {
								// accumulate incoming data to get_file_data
								var new_buf = new Uint8Array(get_file_data.length + sz);
								new_buf.set(get_file_data);
								new_buf.set(data.slice(2), get_file_data.length);
								get_file_data = new_buf;
								update_file_status('Getting ' + get_file_name + ', ' + get_file_data.length + ' bytes');
							}
						} else {
							binary_state = 0;
						}
						break;
					}
				case 23:
					// final response
					if (decode_resp(data) == 0) {
						update_file_status('Got ' + get_file_name + ', ' + get_file_data.length + ' bytes');
						if(get_to_editor){
							editor.setValue((new TextDecoder("utf-8")).decode(get_file_data), 1);
						}
						else{
							saveAs(new Blob([get_file_data], {
								type: "application/octet-stream"
							}), get_file_name);
						}
					} else {
						update_file_status('Failed getting ' + get_file_name);
					}
					binary_state = 0;
					break;
				}
			}
			term.write(event.data);
		};
	};
	ws.onclose = function() {
		connected = false;
		if (term) {
			term.write('\x1b[31mDisconnected\x1b[m\r\n');
		}
		prepare_for_connect();
		$(".when-connteted").attr("disabled","disabled");
		ws = null;
	}
}
function decode_resp(data) {
	if (data[0] == 'W'.charCodeAt(0) && data[1] == 'B'.charCodeAt(0)) {
		var code = data[2] | (data[3] << 8);
		return code;
	} else {
		return - 1;
	}
}
function put_file() {
	put_file_name = document.getElementById('get_filename').value;
	var dest_fname = put_file_name;
	var dest_fsize = put_file_data.length;
	// WEBREPL_FILE = "<2sBBQLH64s"
	var rec = new Uint8Array(2 + 1 + 1 + 8 + 4 + 2 + 64);
	rec[0] = 'W'.charCodeAt(0);
	rec[1] = 'A'.charCodeAt(0);
	rec[2] = 1; // put
	rec[3] = 0;
	rec[4] = 0;
	rec[5] = 0;
	rec[6] = 0;
	rec[7] = 0;
	rec[8] = 0;
	rec[9] = 0;
	rec[10] = 0;
	rec[11] = 0;
	rec[12] = dest_fsize & 0xff;
	rec[13] = (dest_fsize >> 8) & 0xff;
	rec[14] = (dest_fsize >> 16) & 0xff;
	rec[15] = (dest_fsize >> 24) & 0xff;
	rec[16] = dest_fname.length & 0xff;
	rec[17] = (dest_fname.length >> 8) & 0xff;
	for (var i = 0; i < 64; ++i) {
		if (i < dest_fname.length) {
			rec[18 + i] = dest_fname.charCodeAt(i);
		} else {
			rec[18 + i] = 0;
		}
	}
	// initiate put
	binary_state = 11;
	update_file_status('Sending ' + put_file_name + '...');
	ws.send(rec);
}
function get_file(toeditor) {
	var src_fname = document.getElementById('get_filename').value;
	window.localStorage.filename = src_fname;
	// WEBREPL_FILE = "<2sBBQLH64s"
	var rec = new Uint8Array(2 + 1 + 1 + 8 + 4 + 2 + 64);
	rec[0] = 'W'.charCodeAt(0);
	rec[1] = 'A'.charCodeAt(0);
	rec[2] = 2; // get
	rec[3] = 0;
	rec[4] = 0;
	rec[5] = 0;
	rec[6] = 0;
	rec[7] = 0;
	rec[8] = 0;
	rec[9] = 0;
	rec[10] = 0;
	rec[11] = 0;
	rec[12] = 0;
	rec[13] = 0;
	rec[14] = 0;
	rec[15] = 0;
	rec[16] = src_fname.length & 0xff;
	rec[17] = (src_fname.length >> 8) & 0xff;
	for (var i = 0; i < 64; ++i) {
		if (i < src_fname.length) {
			rec[18 + i] = src_fname.charCodeAt(i);
		} else {
			rec[18 + i] = 0;
		}
	}
	// initiate get
	binary_state = 21;
	get_file_name = src_fname;
	get_file_data = new Uint8Array(0);
	update_file_status('Getting ' + get_file_name + '...');
	get_to_editor = toeditor ? true: false;
	ws.send(rec);
}
function handle_put_file_select(evt) {
	// The event holds a FileList object which is a list of File objects,
	// but we only support single file selection at the moment.
	var files = evt.target.files;
	// Get the file info and load its data.
	var f = files[0];
	put_file_name = f.name;
	var reader = new FileReader();
	reader.onload = function(e) {
		put_file_data = new Uint8Array(e.target.result);
		document.getElementById('file-status').innerHTML = 'Selected ' + escape(put_file_name) + ' - ' + put_file_data.length + ' bytes';
		if(ws)
			document.getElementById('put-file-button').disabled = false;
		$("#display-put").show();
	};
	reader.readAsArrayBuffer(f);
}
function put_file_from_editor(){
	put_file_data = new Uint8Array((new TextEncoder("utf-8")).encode(editor.getValue()));
	put_file();
}
function display_put_file(){
	editor.setValue((new TextDecoder("utf-8")).decode(put_file_data), 1);
	document.getElementById('get_filename').value = put_file_name;
	$("#display-put").hide();
}

document.getElementById('put-file-select').addEventListener('change', handle_put_file_select, false);
document.getElementById('put-file-button').disabled = true;