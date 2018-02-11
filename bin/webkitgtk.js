#!/usr/bin/node

var dash = require('dashdash');
var repl = require('repl');
var URL = require('url');
var Path = require('path');
var chalk;
try {
	chalk = require('chalk');
} catch(e) {
	chalk = {};
	['gray', 'red', 'green', 'red'].forEach(function(col) {
		chalk[col] = function(str) { return str; };
	});
}
var parser = dash.createParser({options: [
	{
		names: ['help', 'h'],
		type: 'bool',
		help: 'Print this help and exit.'
	},
	{
		names: ['location', 'l'],
		type: 'bool',
		help: 'Sets only location without actually loading the page'
	},
	{
		names: ['allow-file-access-from-file-urls', 'local-access'],
		type: 'bool',
		help: 'Allow local access from file uris - useful to do local xhr'
	},
	{
		names: ['verbose', 'v'],
		type: 'bool',
		help: 'Log requests and responses'
	},
	{
		names: ['quiet', 'q'],
		type: 'bool',
		help: 'Disable console messages'
	},
	{
		names: ['show'],
		type: 'bool',
		help: 'Show window'
	},
	{
		names: ['resizing'],
		type: 'bool',
		help: 'Allow resizing'
	},
	{
		names: ['width'],
		type: 'integer',
		help: 'Window width'
	},
	{
		names: ['height'],
		type: 'integer',
		help: 'Window height'
	},
	{
		names: ['bare'],
		type: 'bool',
		help: 'Bare window without decoration'
	},
	{
		names: ['transparent'],
		type: 'bool',
		help: 'Transparent window'
	},
	{
		names: ['scripts'],
		type:	'arrayOfString',
		help:	'URL list of scripts to load'
	},
	{
		names: ['command', 'e'],
		type:	'string',
		help:	'execute a command'
	},
	{
		names: ['style'],
		type:	'string',
		help:	'a css string'
	},
	{
		names: ['pdf'],
		type: 'string',
		help: 'pdf output file path'
	},
	{
		names: ['paper'],
		type: 'string',
		help: 'paper name or paper dimensions (iso_a4 or 210x297)'
	},
	{
		names: ['margins'],
		type: 'string',
		help: 'paper margins (10 or 10,10,10,10)'
	},
	{
		names: ['unit'],
		type: 'string',
		help: 'units for paper dimensions and margins, defaults to mm (millimeters)'
	},
	{
		names: ['orientation'],
		type: 'string',
		help: 'orientation landscape or portrait (default)'
	},
	{
		names: ['png'],
		type: 'string',
		help: 'png output file path'
	}
]});

var opts;
try {
	opts = parser.parse(process.argv);
} catch(e) {
	console.error(e.toString());
	opts = {help: true};
}

if (opts.help) {
	var help = parser.help({includeEnv: true}).trimRight();
	console.log('usage: node foo.js [OPTIONS]\n' + 'options:\n' + help);
	process.exit(0);
}

var WebKit = require('../');

var url = opts._args.pop();
if (!url) {
	opts.location = true;
	url = "";
} else {
	var urlObj = URL.parse(url);
	if (!urlObj.protocol) {
		if (url.startsWith('.') || url.startsWith('/')) {
			if (opts['allow-file-access-from-file-urls'] == null) {
				opts['allow-file-access-from-file-urls'] = true;
			}
			url = "file://" + Path.resolve(url);
		} else {
			url = "http://" + url;
		}
	}
}

var render = !!(opts.show || opts.pdf || opts.png);

var loadOpts = {
	content: opts.location ? "<html></html>" : undefined,
	offscreen: !opts.show,
	resizing: opts.resizing,
	filter: !render && function() {
		if (/\.css(\?.*)?$/.test(this.uri)) this.cancel = true;
	},
	console: !opts.quiet,
	inspector: opts.show,
	style: opts.style,
	width: opts.width,
	height: opts.height,
	decorated: !opts.bare,
	transparent: opts.transparent
};

if (opts["auto-load-images"] == null) {
	loadOpts["auto-load-images"] = render;
}
if (opts['allow-file-access-from-file-urls'] != null) {
	loadOpts['allow-file-access-from-file-urls'] = !!opts['allow-file-access-from-file-urls'];
}

var wk = new WebKit();
var p = wk.init(loadOpts).then(function() {
	return wk.load(url, loadOpts);
});

if (opts.scripts) {
	p = p.then(function(wk) {
		return wk.run(function(scripts, done) {
			Promise.all(scripts.map(function(url) {
				return new Promise(function(resolve, reject) {
					var script = document.createElement('script');
					document.head.appendChild(script);
					script.onload = function() {
						script.remove();
						resolve();
					};
					script.onerror = function() {
						script.remove();
						reject(new Error("Failed load of " + url));
					};
					script.src = url;
				});
			})).then(done.bind(null, null)).catch(done);
		}, [opts.scripts]).then(function() {
			return wk;
		});
	});
}
if (opts.pdf) {
	p = p.then(pdf);
} else if (opts.png) {
	p = p.then(png);
} else {
	p = p.then(start);
}
p.then(function() {
	return wk.unload();
}).then(function() {
	return wk.destroy();
});

p.catch(function(err) {
	console.error(err);
	process.exit(1);
});

function dumpCode(cmd) {
	var obj = eval(cmd);
	if (typeof obj == "object") {
		var keys = [];
		for (var k in obj) {
			keys.push(k);
		}
		return keys;
	} else {
		return obj;
	}
}

function pdf(wk) {
	return wk.when('idle', function() {
		var pdfOpts = {};
		if (opts.paper) {
			var paper = {};
			opts.paper.split('x').forEach(function(it, index) {
				if (index == 0) paper.width = parseFloat(it);
				else if (index == 1) paper.height = parseFloat(it);
			});
			paper.unit = opts.unit || 'mm';
			if (paper.width && paper.height) pdfOpts.paper = paper;
			else pdfOpts.paper = opts.paper;
		}
		if (opts.margins) {
			var arr = opts.margins.split(',');
			var margins = {};
			margins.unit = opts.unit || 'mm';
			var index = 0;
			// top right bottom left
			margins.top = parseFloat(arr[index]);
			if (opts.margins.length > 1) index++;
			margins.right = parseFloat(arr[index]);
			if (opts.margins.length > 2) index++;
			margins.bottom = parseFloat(arr[index]);
			if (opts.margins.length > 3) index++;
			margins.left = parseFloat(arr[index]);
			pdfOpts.margins = margins;
		}
		if (opts.orientation && opts.orientation == "landscape") {
			pdfOpts.orientation = opts.orientation;
		}
		console.info(`Generating ${opts.pdf} with options\n`, JSON.stringify(pdfOpts, null, "  "));
		return wk.pdf(opts.pdf, pdfOpts);
	});
}

function png(wk) {
	return wk.when('idle', function() {
		return wk.png(opts.png);
	});
}

function start(wk) {
	var resolve;
	var p = new Promise(function(fun) {
		resolve = fun;
	});
	var pr = repl.start({
		eval: function(cmd, context, filename, cb) {
			if (cmd == ".scope") {
				cmd = "window";
				wk.run(function() {
					return Object.keys(window);
				}, cb);
			} else {
				wk.run(function(cmd) {
					// this trick allows us to eval in global context
					// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval
					var geval = eval;
					var obj = geval(cmd);
					if (/string|number|boolean/.test(typeof obj)) return obj;
					var ret = {}, val;
					for (var k in obj) {
						try {
							val = obj[k];
						} catch(e) {
							val = null;
						}
						if (!val || /string|number|boolean/.test(typeof val)) {
							ret[k] = val;
							continue;
						}
						try {
							var tmp = JSON.stringify(val);
							if (tmp != null) {
								ret[k] = val;
								continue;
							}
						} catch(e) {
						}

						if (val.nodeType) {
							try {
								var div = val.ownerDocument.createElement('div');
								div.appendChild(val.cloneNode(false));
								ret[k] = div.innerHTML;
							} catch(e) {
							}
						}
						if (ret[k] == null) ret[k] = val + "";
					}
					return ret;
				}, cmd, function(err, result) {
					if (err) console.error(err);
					cb(err, result);
				});
			}
		}
	}).on('exit', function() {
		resolve();
	});
	pr.context = {};
	if (opts.command) pr.eval(opts.command, {}, 'opts', function(err) {
		if (err) console.error(err);
	});
	return p;
}

if (opts.verbose) {
	wk.on('response', function(res) {
		var list = [res.status < 400 ? res.status : chalk.red(res.status)];
		var type = res.headers['Content-Type'];
		if (type) list.push(chalk.gray(onlyMime(type)));
		list.push(onlyPath(wk.uri, res.uri), chalk.green(res.length));
		console.info(list.join(' '));
	});
}

function onlyMime(str) {
	var mime = str.split(';').shift() || str;
	return mime.split('/').pop() || str;
}

function onlyPath(root, str) {
	var len = root.slice(-1) == "/" ? root.length - 1 : root.length;
	if (str.indexOf(root) == 0) str = str.substring(len);
	if (!str) str = ".";
	return str;
}

