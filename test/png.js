var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("png method", function suite() {
	it("should wait for load event and save a screenshot to disk", function(done) {
		this.timeout(10000);
		var filepath = __dirname + '/shots/test.png';
		WebKit().load("https://www.debian.org/").png(filepath, function(err) {
			expect(err).to.not.be.ok();
			fs.stat(filepath, function(err, stat) {
				expect(stat.size).to.be.above(50000);
				done();
			});
		});
	});
	it("should save a screenshot to disk", function(done) {
		this.timeout(10000);
		var filepath = __dirname + '/shots/test2.png';
		WebKit(98).load("https://www.debian.org/", {
			width: 512,
			height: 512,
			stylesheet: __dirname + "/../css/png.css"
		}, function(err) {
			expect(err).to.not.be.ok();
		}).on("request", function(req) {
			if (/\.js$/.test(req.uri)) req.uri = null;
		}).on("load", function() {
			this.png(filepath, function(err) {
				expect(err).to.not.be.ok();
				fs.stat(filepath, function(err, stat) {
					expect(stat.size).to.be.above(30000);
					done();
				});
			});
		});
	});
});


