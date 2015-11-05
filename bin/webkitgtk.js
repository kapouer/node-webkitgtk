#!/usr/bin/node

var dash = require('dashdash');
var repl = require('repl');
var URL = require('url');

var opts = dash.parse({options: [
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
		names: ['verbose', 'v'],
		type: 'bool',
		help: 'Log requests and responses'
	},
	{
		names: ['show'],
		type: 'bool',
		help: 'Show window'
	}
]});

var W = require('../');

var url = opts._args.pop();
if (!url) {
	opts.location = true;
	url = "";
} else {
	var urlObj = URL.parse(url);
	if (!urlObj.protocol) url = "http://" + url;
}

var inst = W.load(url, {
	content: opts.location ? "" : undefined,
	offscreen: !opts.show
}, function(err) {
	repl.start({
		eval: function(cmd, context, filename, cb) {
			if (cmd == ".scope") {
				console.log("cmd is SCOPE");
			}
			var fun = function(cmd) {
				if (typeof cmd == "object") {
					var obj = {};
					for (var k in cmd) {
						obj[k] = true;
					}
					return obj;
				} else {
					return cmd;
				}
			}.toString();
			inst.run('(' + fun + ')(' + cmd + ')', function(err, result) {
				if (err) console.error(err);
				cb(err, result);
			});
		}
	}).on('exit', function() {
		inst.unload(function() {
			inst.destroy();
		});
	});
});

