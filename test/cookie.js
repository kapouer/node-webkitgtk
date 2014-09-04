var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');


describe("cookies option", function suite() {
	it("should set Cookie HTTP header on second request", function(done) {
		var count = 0;
		var cookiestr = "mycookie=myvalue";
		require('http').createServer(function(req, res) {
			if (req.url == "/") count++;
			if (count == 2) expect(req.headers.cookie).to.be(cookiestr);
			res.write('<html><body><img src="myimg.png"/></body></html>');
			res.end();
		}).listen(8008);

		WebKit("http://localhost:8008", {cookies:cookiestr + ";Path=/"}, function(err, view) {
			expect(err).to.not.be.ok();
			expect(count).to.be(2);
			done();
		});
	});
});

