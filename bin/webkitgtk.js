#!/usr/bin/node

var dash = require('dashdash');
var repl = require('repl');
var URL = require('url');
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

var W = require('../');

var url = opts._args.pop();
if (!url) {
	opts.location = true;
	url = "";
} else {
	var urlObj = URL.parse(url);
	if (!urlObj.protocol) url = "http://" + url;
}

var loadOpts = {
	content: opts.location ? "<html></html>" : undefined,
	offscreen: !opts.show,
	filter: !opts.show && function() {
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

if (opts["auto-load-images"] == null && opts.show != null) {
	loadOpts["auto-load-images"] = opts.show;
}
if (opts['allow-file-access-from-file-urls'] != null) {
	loadOpts['allow-file-access-from-file-urls'] = !!opts['allow-file-access-from-file-urls'];
}

var wk = W.load(url, loadOpts, function(err) {
	if (opts.scripts) {
		wk.run(function(scripts, done) {
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
		}, [opts.scripts], function(err) {
			if (err) console.error(err);
			start(wk);
		});
	} else {
		start(wk);
	}
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

function start(wk) {
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
		wk.unload(function() {
			wk.destroy();
		});
	});
	pr.context = {};
	if (opts.command) pr.eval(opts.command, {}, 'opts', function(err) {
		if (err) console.error(err);
	});
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

