var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("png method", function suite() {
	it("should wait for load event and save a screenshot to disk", function(done) {
		this.timeout(10000);
		var filepath = __dirname + '/shots/test.png';
		WebKit(function(err, w) {
			w.load("https://www.debian.org/").once('load', function() {
				this.png(filepath, function(err) {
					expect(err).to.not.be.ok();
					fs.stat(filepath, function(err, stat) {
						expect(stat.size).to.be.above(50000);
						done();
					});
				});
			});
		});
	});

	it("should save a screenshot to disk", function(done) {
		this.timeout(10000);
		var filepath = __dirname + '/shots/test2.png';
		WebKit(function(err, w) {
			w.load("https://www.debian.org/", {
				width: 512,
				height: 512,
				style: fs.readFileSync(__dirname + "/../css/png.css")
			}, function(err) {
				expect(err).to.not.be.ok();
			}).on("request", function(req) {
				if (/\.js$/.test(req.uri)) req.uri = null;
			}).once("load", function() {
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

	it("should not crash when calling png right now and twice in a row", function(done) {
		var w = new WebKit();
		w.init(function() {
			w.load('https://www.debian.org').once('load', function() {
				var count = 0;
				// this won't even generate a png since no surface is yet acquired
				w.png(__dirname + '/shots/testr1.png', function(err) {
					expect(err).to.not.be.ok();
					expect(count).to.be(1);
					done();
				});
				var ex;
				try {
					w.png(__dirname + '/shots/testr2.png', function(err) {
						expect(true).to.be(false);
					});
				} catch(e) {
					ex = e;
				}
				expect(ex).to.be.ok();
				count++;
			});
		});
	});

	it("should error out when called before document and is loaded", function(done) {
		var w = new WebKit();
		w.init(function() {
			w.load('https://www.debian.org');
			// this won't even generate a png since no surface is yet acquired
			w.png(__dirname + '/shots/testr1err.png', function(err) {
				expect(err).to.be.ok();
				done();
			});
		});
	});
});

