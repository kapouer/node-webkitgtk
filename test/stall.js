const WebKit = require('../');
const expect = require('expect.js');

describe("stall load options", () => {
	it("should not account for idling if > stallTimeout", (done) => {
		let port;
		const server = require('http').createServer((req, res) => {
			res.statusCode = 200;
			res.end('<html><head><script type="text/javascript">\
			setTimeout(function() {window.testDone = true;}, 400);\
			</script></head><body>test</body></html>');
		}).listen(() => {
			port = server.address().port;
			WebKit((err, w) => {
				// increasing stall here to 1000 will fail the test (expectedly)
				w.load("http://localhost:" + port, {stallTimeout:100, console: true})
					.once('idle', function() {
						this.run((cb) => {
							cb(null, window.testDone ? 'yes' : 'no');
						}, (err, result) => {
							expect(result).to.be('no');
							server.close();
							done();
						});
					});
			});
		});
	});
	it("should account for idling if < stallTimeout", (done) => {
		let port;
		const server = require('http').createServer((req, res) => {
			res.statusCode = 200;
			res.end('<html><head><script type="text/javascript">\
			setTimeout(function() {window.testDone = true;}, 400);\
			</script></head><body>test</body></html>');
		}).listen(() => {
			port = server.address().port;
			WebKit((err, w) => {
				// increasing stall here to 1000 will fail the test (expectedly)
				w.load("http://localhost:" + port, {stallTimeout:500, console: true})
					.once('idle', function() {
						this.run((cb) => {
							cb(null, window.testDone ? 'yes' : 'no');
						}, (err, result) => {
							expect(result).to.be('yes');
							server.close();
							done();
						});
					});
			});
		});
	});
	it("should not account for idling if > stallInterval", (done) => {
		let port;
		const server = require('http').createServer((req, res) => {
			res.statusCode = 200;
			res.end('<html><head><script type="text/javascript">\
			window.testDone = 0;\
			setInterval(function() {window.testDone++;}, 200);\
			</script></head><body>test</body></html>');
		}).listen(() => {
			port = server.address().port;
			WebKit((err, w) => {
				// increasing stall here to 1000 will fail the test (expectedly)
				w.load("http://localhost:" + port, {stallInterval:500, console: true})
					.once('idle', function() {
						this.run((cb) => {
							cb(null, window.testDone);
						}, (err, result) => {
							expect(result).to.be(2);
							server.close();
							done();
						});
					});
			});
		});
	});
	it("should not account for idling if > stallFrame", function(done) {
		this.timeout(1500);
		let port;
		const server = require('http').createServer((req, res) => {
			res.statusCode = 200;
			res.end(`<html><head><script type="text/javascript">
			window.testDone = 0;
			(function doRAF() {
				if (window.requestAnimationFrame) window.requestAnimationFrame(function() {
					doRAF();
					testDone++;
				});
				else testDone = 11; // don't break test
			})();
			</script></head><body>test</body></html>`);
		}).listen(() => {
			port = server.address().port;
			WebKit((err, w) => {
				// increasing stall here to 1000 will fail the test (expectedly)
				w.load("http://localhost:" + port, {stallFrame:300, console: true})
					.once('idle', function() {
						this.run((cb) => {
							cb(null, window.testDone);
						}, (err, result) => {
							expect(result).to.be.greaterThan(10);
							server.close();
							done();
						});
					});
			});
		});
	});
});

