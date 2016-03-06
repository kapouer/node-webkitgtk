var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');
var join = require('path').join;


describe("stall load options", function suite() {
	it("should not account for idling if > stallTimeout", function(done) {
		var port;
		var server = require('http').createServer(function(req, res) {
			res.statusCode = 200;
			res.end('<html><head><script type="text/javascript">\
			setTimeout(function() {window.testDone = true;}, 400);\
			</script></head><body>test</body></html>');
		}).listen(function() {
			port = server.address().port;
			WebKit(function(err, w) {
				// increasing stall here to 1000 will fail the test (expectedly)
				w.load("http://localhost:" + port, {stallTimeout:100, console: true})
				.once('idle', function() {
					this.run(function(cb) {
						cb(null, window.testDone ? 'yes' : 'no');
					}, function(err, result) {
						expect(result).to.be('no');
						server.close();
						done();
					});
				});
			});
		});
	});
	it("should account for idling if < stallTimeout", function(done) {
		var port;
		var server = require('http').createServer(function(req, res) {
			res.statusCode = 200;
			res.end('<html><head><script type="text/javascript">\
			setTimeout(function() {window.testDone = true;}, 400);\
			</script></head><body>test</body></html>');
		}).listen(function() {
			port = server.address().port;
			WebKit(function(err, w) {
				// increasing stall here to 1000 will fail the test (expectedly)
				w.load("http://localhost:" + port, {stallTimeout:500, console: true})
				.once('idle', function() {
					this.run(function(cb) {
						cb(null, window.testDone ? 'yes' : 'no');
					}, function(err, result) {
						expect(result).to.be('yes');
						server.close();
						done();
					});
				});
			});
		});
	});
	it("should not account for idling if > stallInterval", function(done) {
		var port;
		var server = require('http').createServer(function(req, res) {
			res.statusCode = 200;
			res.end('<html><head><script type="text/javascript">\
			window.testDone = 0;\
			setInterval(function() {window.testDone++;}, 200);\
			</script></head><body>test</body></html>');
		}).listen(function() {
			port = server.address().port;
			WebKit(function(err, w) {
				// increasing stall here to 1000 will fail the test (expectedly)
				w.load("http://localhost:" + port, {stallInterval:500, console: true})
				.once('idle', function() {
					this.run(function(cb) {
						cb(null, window.testDone);
					}, function(err, result) {
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
		var port;
		var server = require('http').createServer(function(req, res) {
			res.statusCode = 200;
			res.end(`<html><head><script type="text/javascript">
			window.testDone = 0;
			(function doRAF() {
				window.requestAnimationFrame(function() {
					doRAF();
					testDone++;
				});
			})();
			</script></head><body>test</body></html>`);
		}).listen(function() {
			port = server.address().port;
			WebKit(function(err, w) {
				// increasing stall here to 1000 will fail the test (expectedly)
				w.load("http://localhost:" + port, {stallFrame:300, console: true})
				.once('idle', function() {
					this.run(function(cb) {
						cb(null, window.testDone);
					}, function(err, result) {
						expect(result).to.be.greaterThan(10);
						server.close();
						done();
					});
				});
			});
		});
	});
});

