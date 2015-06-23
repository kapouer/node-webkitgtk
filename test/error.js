var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');
describe("error reporting", function suite() {
	it("should catch script errors", function(done) {
		this.timeout(1000);
		WebKit().load("").run(function(done) {
			setTimeout(function() {
				var r = 2 + h;
				done(); // won't actually be called
			}, 100);
		}, function(err) {
			expect(err).to.not.be.ok();
		}).on('error', function(msg, uri, line, col, err) {
			expect(msg).to.be('Script error.');
			done();
		}).on('unload', function() {});
	});
	it("should log uncaught Error instances with actual exception stack", function(done) {
		this.timeout(1000);
		WebKit().load("").run(function(done) {
			setTimeout(function myfunc() {
				throw new Error("i am here");
				done(); // won't actually be called
			}, 100);
		}, function(err) {
			expect(err).to.not.be.ok();
		}).on('error', function(msg, uri, line, col, err) {
			expect(err).to.be.ok();
			expect(err.message).to.be("i am here");
			expect(err.stack).to.be.ok();
			done();
		}).on('unload', function() {});
	});
});
