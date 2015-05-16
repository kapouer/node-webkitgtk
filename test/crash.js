var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');
var path = require('path');

describe("concurrent png calls should not crash", function suite() {
	this.timeout(10000);
	var w;
	before(function(cb) {
		var inst = new WebKit();
		inst.init({}, function(err) {
			if (err) return cb(err);
			w = inst;
			cb();
		});
	});
	it("first call wrongly assumes idle event is not called", function(done) {
		var href = "https://www.mezilla.org/en-US/";
		var filePath = path.resolve(__dirname, './shots/out1.png');
		w.once('idle', function() {
			w.png(filePath, function(err) {
				expect(err).to.not.be.ok();
			});
		});
		w.load(href, {}, function(err) {
			expect(err).to.be.ok();
			done();
		});
	});
	it("second call calls png actually just after first call and must not crash", function(done) {
		var href = "https://www.google.com";
		var filePath = path.resolve(__dirname, './shots/out2.png');
		w.once('idle', function() {
			try {
				w.png(filePath, function(err) {
					done();
				});
			} catch(e) {}
		});
		w.load(href, {}, function(err) {
			expect(err).to.not.be.ok();
			setTimeout(done, 1000);
		});
	});
});

