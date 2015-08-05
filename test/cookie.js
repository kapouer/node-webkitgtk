var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');


describe("cookies option", function suite() {
	var port, server;
	var countOne = 0;
	var cookiestrOne = "mycookie=myvalue";
	var countTwo = 0;
	var cookiestrTwo = "mycookie=myvalue2";

	before(function(done) {
		server = require('http').createServer(function(req, res) {
			if (req.url == "/test/one") {
				if (countOne == 0) expect(req.headers.cookie).to.be(cookiestrOne);
				countOne++;
				res.write('<html><body><img src="myimg.png"/></body></html>');
			} else if (req.url == "/test/two") {
				if (countTwo == 0) expect(req.headers.cookie).to.be(cookiestrOne);
				if (countTwo == 1) expect(req.headers.cookie).to.be(cookiestrTwo);
				countTwo++;
				res.write('<html><body><img src="myimg.png"/></body></html>');
			} else {
				res.writeHeader(404);
			}
			res.end();
		}).listen(function() {
			port = server.address().port;
			done();
		});
	});
	after(function(done) {
		server.close();
		done();
	});

	it("should set Cookie HTTP header on first request", function(done) {
		WebKit.load("http://localhost:" + port + "/test/one", {cookies:cookiestrOne + ";Path=/test/one"}, function(err, w) {
			expect(err).to.not.be.ok();
			expect(countOne).to.be(1);
			done();
		});
	});

	it("should set a different Cookie HTTP header on a subsequent load", function(done) {
		var count = 0;
		var cookiestr = "mycookie=myvalue";
		var cookiestr2 = "mycookie=myvalue2";

		WebKit.load("http://localhost:" + port + "/test/two", {cookies:cookiestrOne + ";Path=/test/two"}, function(err, w) {
			expect(err).to.not.be.ok();
			expect(countTwo).to.be(1);
			w.unload(function() {
				w.load("http://localhost:" + port + "/test/two", {cookies:cookiestrTwo + ";Path=/test/two"}, function(err) {
					expect(err).to.not.be.ok();
					expect(countTwo).to.be(2);
					done();
				});
			});
		});
	});
});

