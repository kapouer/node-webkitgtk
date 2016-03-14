var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("wait for event", function suite() {
	it("idle then wait again for idle should call immediately", function(done) {
		WebKit.load("http://localhost", {content: '<p>test</p>'}).when('idle', function(wcb) {
			setTimeout(function() {
				var startTime = Date.now();
				this.when('idle', function(wcb) {
					var stopTime = Date.now();
					expect(stopTime - startTime).to.be.lessThan(10);
					wcb();
					done();
				});
			}.bind(this), 50);
			wcb();
		});
	});

	it("load then call png", function(done) {
		this.timeout(10000);
		var filepath = __dirname + '/shots/testwait.png';
		WebKit.load("https://www.debian.org/").once("load", function(err) {
			this.png(filepath, function(err) {
				expect(err).to.not.be.ok();
				fs.stat(filepath, function(err, stat) {
					expect(stat.size).to.be.above(50000);
					done();
				});
			});
		});
	});

	it("idle then call png", function(done) {
		this.timeout(10000);
		var filepath = __dirname + '/shots/test3.png';
		WebKit.load("https://www.debian.org/").once("idle", function(err) {
			this.png(filepath, function(err) {
				expect(err).to.not.be.ok();
				fs.stat(filepath, function(err, stat) {
					expect(stat.size).to.be.above(50000);
					done();
				});
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
		WebKit.load("https://www.debian.org/")
			.once('ready', called.bind(null, 0, "ready"))
			.once('load', called.bind(null, 1, "load"))
			.once('idle', called.bind(null, 2, "idle"));
	});

	it("then chain then wait another event and chain", function(done) {
		this.timeout(5000);
		var pngpath = __dirname + '/shots/test4.png';
		var pdfpath = __dirname + '/shots/test4.pdf';
		var called = 0;
		var w = WebKit.load("https://www.debian.org")
		.when('ready', function(cb) {
			this.html(function(err, str) {
				expect(err).to.not.be.ok();
				expect(str.length).to.be.above(2000);
				called++;
				cb();
			});
		})
		.when('load', function(cb) {
			this.pdf(pdfpath, function(err) {
				expect(err).to.not.be.ok();
				fs.stat(pdfpath, function(err, stat) {
					expect(stat.size).to.be.above(50000);
					called++;
					cb();
				});
			});
		})
		.when('idle', function(cb) {
			this.png(pngpath, function(err) {
				fs.stat(pngpath, function(err, stat) {
					expect(stat.size).to.be.above(50000);
					expect(called).to.be(2);
					cb();
					done();
				});
			});
		});
	});
	it("in any order", function(done) {
		this.timeout(3000);
		var page = WebKit.load("https://www.debian.org/").once("ready", function(err) {
			expect(err).to.not.be.ok();
			page.when('idle', function() {
				page.when('idle', function() {
					page.when('ready', function() {
						done();
					});
				});
			});
		});
	});
});

