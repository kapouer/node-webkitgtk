var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("wait for event", function suite() {
	it("load then call png", function(done) {
		this.timeout(10000);
		var filepath = __dirname + '/shots/testwait.png';
		WebKit().load("https://www.debian.org/").wait("load").png(filepath, function(err) {
			expect(err).to.not.be.ok();
			fs.stat(filepath, function(err, stat) {
				expect(stat.size).to.be.above(50000);
				done();
			});
		});
	});
	it("idle then call png", function(done) {
		this.timeout(10000);
		var filepath = __dirname + '/shots/test3.png';
		WebKit().load("https://www.debian.org/").wait("idle").png(filepath, function(err) {
			expect(err).to.not.be.ok();
			fs.stat(filepath, function(err, stat) {
				expect(stat.size).to.be.above(50000);
				done();
			});
		});
	});
	it("ready then load then idle then unload", function(done) {
		this.timeout(5000);
		var calls = 0;
		function called(num, ev) {
			expect(calls).to.be(num);
			calls++;
			if (calls == 3) done();
		}
		WebKit().load("https://www.debian.org/")
			.wait('ready', called.bind(null, 0, "ready"))
			.wait('load', called.bind(null, 1, "load"))
			.wait('idle', called.bind(null, 2, "idle"));
	});
	it("then chain then wait another event and chain", function(done) {
		this.timeout(5000);
		var pngpath = __dirname + '/shots/test4.png';
		var pdfpath = __dirname + '/shots/test4.pdf';
		var called = 0;
		WebKit().load("https://www.debian.org").wait('ready').html(function(err, str) {
			expect(err).to.not.be.ok();
			expect(str.length).to.be.above(2000);
			called++;
		}).wait('load').pdf(pdfpath, function(err) {
			expect(err).to.not.be.ok();
			fs.stat(pdfpath, function(err, stat) {
				expect(stat.size).to.be.above(50000);
				called++;
			});
		}).wait('idle').png(pngpath, function(err) {
			fs.stat(pngpath, function(err, stat) {
				expect(stat.size).to.be.above(50000);
				expect(called).to.be(2);
				done();
			});
		});
	});
	it("in any order and detect wrong order", function(done) {
		this.timeout(1000);
		WebKit().load("https://www.debian.org/").wait("ready", function(err) {
			expect(err).to.not.be.ok();
			this.wait('idle', function(err) {
				this.wait('idle', function(err) {
					this.wait('ready', function(err) {
						expect(err).to.be.ok();
						done();
					});
				});
			});
		});
	});
});

