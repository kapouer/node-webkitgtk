var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("run method", function suite() {
	it("should emit two 'test' events with arguments", function(done) {
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
	it("should pass fail when missing custom arguments mismatch script signature", function(done) {
		WebKit().load("http://localhost", {content:'<html></html>'}).run(function(nonstringifyable, cb) {
			// here the first argument is in fact cb, en cb is empty because nonstringifyable is missing
			cb(null, nonstringifyable); // won't actually be called
		}, function(err, results, cb) {
			expect(err).to.be.ok();
			done();
		});
	});
	it("should throw error when passing non-stringifyable custom argument", function(done) {
		WebKit().load("http://localhost", {content:'<html></html>'}).run(function(obj, arr, str, done) {
			done(null, obj.a, arr[1], str);
		}, {a:1}, ["a", 4], "testé\n", function(err, a1, b4, ctest, cb) {
			expect(err).to.not.be.ok();
			expect(a1).to.be(1);
			expect(b4).to.be(4);
			expect(ctest).to.be("testé\n");
			cb();
		}).html(function(err, str) {
			// make sure we are called back
			done();
		});
	});
	it("should just work with script and script callback", function(done) {
		WebKit().load("http://localhost", {content:'<html></html>'}).run(function(done) {
			done(null, "stuff");
		}, function(err, stuff, cb) {
			expect(err).to.not.be.ok();
			expect(stuff).to.be("stuff");
			cb();
		}).html(function(err, str) {
			// make sure we are called back
			done();
		});
	});
	it("should run sync", function(done) {
		WebKit().load("http://localhost", {content:'<html></html>'}).run("document.body.outerHTML", function(err, html, cb) {
			expect(err).to.not.be.ok();
			expect(html).to.be("<body></body>");
			cb()
		}).html(function(err, str) {
			// make sure we are called back
			done();
		});
	});
});
