var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("error reporting", function suite() {
	it("should catch async script errors", function(done) {
		this.timeout(1000);
		var w = WebKit.load("", function(err) {
			w.run(function(done) {
				setTimeout(function() {
					var r = 2 + h;
					done(); // won't actually be called
				}, 100);
			}, function(err) {
				expect(err).to.not.be.ok();
			});
			w.on('error', function(msg, uri, line, col, err) {
				expect(msg).to.be('Script error.');
				done();
			});
		});
	});
	it("should catch sync script errors", function(done) {
		this.timeout(1000);
		var w = WebKit.load("http://localhost", {content: '<html></html>'}, function(err) {
			w.run(function() {
				document.createWhatever("tata");
			}, function(err) {
				expect(err && err.stack).to.be.ok();
				done();
			});
		});
	});
	it("should log uncaught Error instances with actual exception stack", function(done) {
		this.timeout(1000);
		WebKit(function(err, w) {
			w.load("", function(err) {
				w.run(function(done) {
					setTimeout(function myfunc() {
						throw new Error("i am here");
						done(); // won't actually be called
					}, 100);
				}, function(err) {
					expect(err).to.not.be.ok();
				});
			});
			w.on('error', function(msg, uri, line, col, err) {
				expect(err).to.be.ok();
				expect(err.message).to.be("i am here");
				expect(err.stack).to.be.ok();
				done();
			});
		});
	});
});
