var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("error reporting", function suite() {
	it("should catch async script errors", function(done) {
		this.timeout(1000);
		var w = WebKit.load("http://localhost", {content: '<html></html>'}, function(err) {
			w.run(function(done) {
				setTimeout(function() {
					var r = 2 + h;
					done(); // won't actually be called
				}, 100);
			}, function(err) {
				expect(err).to.be.ok(); // timeout
			});
			w.on('error', function(msg, uri, line, col, err) {
				expect(msg).to.be('ReferenceError: Can\'t find variable: h');
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
			w.load("http://localhost", {content: '<html></html>'}, function(err) {
				w.run(function(done) {
					setTimeout(function myfunc() {
						var err = new SyntaxError("i am here");
						err.code = 404;
						throw err;
						done(); // won't actually be called
					}, 100);
				}, function(err) {
					expect(err).to.be.ok(); // timeout
				});
			});
			w.on('error', function(msg, uri, line, col, err) {
				expect(err).to.be.ok();
				expect(err.message).to.be("i am here");
				expect(err.code).to.be(404);
				expect(err.name).to.be("SyntaxError");
				expect(err instanceof SyntaxError).to.be.ok();
				expect(err.stack).to.be.ok();
				done();
			});
		});
	});
});
