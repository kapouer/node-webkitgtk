var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');
var join = require('path').join;


describe("long polling", function suite() {
	it("should idle before server sends message", function(done) {
		this.timeout(6000);
		var engine = require('engine.io');
		var server = require('http').createServer(function(req, res) {
			res.statusCode = 200;
			if (req.url == "/engine.io.js") {
				fs.readFile(join(__dirname, '../node_modules/engine.io-client/engine.io.js'), function(err, buf) {
					if (err) console.error(err);
					res.end(buf);
				});
			} else {
				var script = function() {
					var socket = new eio.Socket("ws://localhost:8019/", {transports:['polling']});
					socket.on("open", function() {
						socket.on("message", function(data) {
							window.mymessage = data;
						});
						socket.on("close", function(){});
					});
				}.toString();
				res.end('<html><script type="text/javascript" src="/engine.io.js"></script><script type="text/javascript">('+script+')();</script><body>test</body></html>');
			}
		}).listen(8019);
		var engineServer = engine.attach(server);
		var sent = false;
		engineServer.on('connection', function (socket) {
			setTimeout(function() {
				sent = true;
				socket.send("some server data");
			}, 3000);
		});
		WebKit().load("http://localhost:8019", {stall:2000}).wait('idle', function(err) {
			this.run('window.mymessage', function(err, data) {
				expect(data).to.not.be.ok();
				setTimeout(function() {
					expect(sent).to.be.ok();
					server.close();
					engineServer.close();
					done();
				}, 2000);
			});
		});
	});
});

