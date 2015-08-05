var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("unload method", function suite() {
	it("should be set to an empty document with an empty url", function(done) {
		WebKit(function(err, w) {
			w.unload(function() {
				w.run("document.documentElement.outerHTML;", function(err, html) {
					expect(err).to.not.be.ok();
					expect(html).to.be('<html><head></head><body></body></html>');
					expect(this.uri).to.be("");
					done();
				});
			});
		});
	});

	it("should allow chaining load-unload-load", function(done) {
		this.timeout(10000);
		WebKit.load('http://google.com', function(err, w) {
			w.unload(function(err) {
				expect(err).to.not.be.ok();
				w.load('http://www.selmer.fr', function(err) {
					expect(err).to.not.be.ok();
					done();
				});
			});
		});
	});

	it("should remove all listeners and not fail on next load", function(done) {
		this.timeout(10000);
		var v = new WebKit();
		v.init(0, function(err) {
			v.load('http://google.com', {allow: "none"});
			v.once('ready', function() {
				v.unload(function(err) {
					v.removeAllListeners();
					v.load('http://github.com', {allow:"none"});
					v.once('ready', function() {
						done();
					});
				});
			});
		});
	});

	it("should allow chaining load-unload-load with content", function(done) {
		this.timeout(2000);
		WebKit.load('http://google.com', {content: '<html><body>pisderman</body></html>'}, function(err, w) {
			w.unload(function(err) {
				expect(err).to.not.be.ok();
				w.load('http://www.selmer.fr', {content: '<html><body>volapuk</body></html>'}, function(err) {
					expect(err).to.not.be.ok();
					done();
				});
			});
		});
	});
});
