const WebKit = require('../');
const expect = require('expect.js');
const fs = require('fs');
const join = require('path').join;


describe("long polling", function suite() {
	this.timeout(3000);
	it("should idle before server sends message", (done) => {
		const engine = require('engine.io');
		let port;
		let sent = false;

		const server = require('http').createServer((req, res) => {
			res.statusCode = 200;
			if (req.url == "/engine.io.js") {
				fs.readFile(join(__dirname, '../node_modules/engine.io-client/dist/engine.io.js'), (err, buf) => {
					if (err) console.error(err);
					res.end(buf);
				});
			} else {
				const script = function () {
					// eslint-disable-next-line no-undef
					const socket = new window.eio.Socket("ws://localhost:" + PORT + '/', { transports: ['polling'] });
					socket.on("open", () => {
						socket.on("message", (data) => {
							window.mymessage = data;
						});
						socket.on("close", () => { });
					});
				}.toString().replace('PORT', port);
				res.end('<html><script type="text/javascript" src="/engine.io.js"></script><script type="text/javascript">(' + script + ')();</script><body>test</body></html>');
			}
		});
		const engineServer = engine.attach(server);
		server.listen(() => {
			port = server.address().port;
			WebKit((err, w) => {
				// increasing stall here to 1000 will fail the test (expectedly)
				w.load("http://localhost:" + port, {stall:500, console: true})
					.once('idle', function(err) {
						this.run("window.mymessage", (err, data) => {
							expect(data).to.not.be.ok();
							setTimeout(() => {
								expect(sent).to.be.ok();
								server.close();
								engineServer.close();
								done();
							}, 700);
						});
					});
			});
		});
		engineServer.on('connection', (socket) => {
			setTimeout(() => {
				sent = true;
				socket.send("some server data");
			}, 900);
		});
	});
});

