var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');
var path = require('path');

describe.only("Experiment", function suite() {
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
	it("reports an error on Bad URL", function(done) {
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
	it("should render Good URL after a bad one", function(done) {
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

