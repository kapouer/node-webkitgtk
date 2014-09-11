var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("png method", function suite() {
	it("should save a screenshot to disk", function(done) {
		this.timeout(10000);
		WebKit("https://www.debian.org/", {
			display: 98,
			xfb: true,
			width:800, height:600,
			stylesheet: __dirname + "/../css/png.css"
		}, function(err) {
			expect(err).to.not.be.ok();
		}).on("request", function(req) {
			if (/\.js$/.test(req.uri)) req.uri = null;
		}).on("load", function() {
			var filepath = __dirname + '/shots/test.png';
			this.png().save(filepath, function(err) {
				expect(err).to.not.be.ok();
				fs.stat(filepath, function(err, stat) {
					expect(stat.size).to.be.above(50000);
					done();
				});
			});
		});
	});
});


