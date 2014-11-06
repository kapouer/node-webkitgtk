var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');


describe("cookies option", function suite() {
	it("should set Cookie HTTP header on first request", function(done) {
		var count = 0;
		var cookiestr = "mycookie=myvalue";
		var server = require('http').createServer(function(req, res) {
			if (req.url == "/test/") count++;
			if (count == 1) expect(req.headers.cookie).to.be(cookiestr);
			res.write('<html><body><img src="myimg.png"/></body></html>');
			res.end();
		}).listen(8008);

		WebKit().load("http://localhost:8008/test/", {cookies:cookiestr + ";Path=/test"}, function(err, view) {
			expect(err).to.not.be.ok();
			expect(count).to.be(1);
			setImmediate(function() {
				server.close();
				done();
			});
		});
	});
	it("should set a different Cookie HTTP header on a subsequent load", function(done) {
		var count = 0;
		var cookiestr = "mycookie=myvalue";
		var cookiestr2 = "mycookie=myvalue2";
		var server = require('http').createServer(function(req, res) {
			if (req.url == '/test2/') count++;
			if (count == 2) expect(req.headers.cookie).to.be(cookiestr2);
			res.write('<html><body><img src="myimg.png"/></body></html>');
			res.end();
		}).listen(8009);

		WebKit().load("http://localhost:8009/test2/", {cookies:cookiestr + ";Path=/test2"}, function(err, view) {
			expect(err).to.not.be.ok();
			expect(count).to.be(1);
			view.unload(function() {
				view.load("http://localhost:8009/test2/", {cookies:cookiestr2 + ";Path=/test2"}, function(err) {
					expect(err).to.not.be.ok();
					expect(count).to.be(2);
					setImmediate(function() {
						server.close();
						done();
					});
				});
			});
		});
	});
});

