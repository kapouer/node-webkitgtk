var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("runev method", function suite() {
	it("should emit two custom 'test' events with arguments", function(done) {
		this.timeout(1000);
		var countCalls = 1;
		WebKit().load("").runev(function(emit) {
			var count = 0;
			(function twice() {
				if (count > 0) emit('testev', count, "hello");
				if (++count == 3) return;
				setTimeout(twice, 100);
			})();
		}).on('testev', function(count, hello) {
			expect(hello).to.be("hello");
			expect(countCalls++).to.be(count);
			if (count == 2) done();
		}).on('unload', function() {});
	});
	it("should catch a global error", function(done) {
		this.timeout(1000);
		WebKit().load("").run(function(done) {
			setTimeout(function() {
				var r = 2 + h;
				done(); // won't actually be called
			}, 100);
		}, function(err) {
			expect(err).to.not.be.ok();
		}).on('error', function(msg, uri, line, column) {
			expect(msg).to.be('Script error.');
			done();
		}).on('unload', function() {});
	});
});
