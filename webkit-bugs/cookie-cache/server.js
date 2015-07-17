#!/usr/bin/env node

var server = require('http').createServer(function(req, res) {
	res.setHeader('Cache-Control', 'no-cache, must-revalidate');
	if (req.url == "/xhr") {
		console.log("received xhr request with headers", req.headers);
		if (req.headers.cookie == 'sid=secondcookie') {
			console.error("*** received secondcookie instead of firstcookie ***");
		}
		res.setHeader("Content-Type", "application/json");
		res.write('{"some": "json"}');
		res.end();
	} else {
		console.error("should not receive", req.url);
		res.writeHead(404);
		res.end();
	}
}).listen(40001);
