var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("unload method", function suite() {
	it("should be set to an empty document with an empty url", function(done) {
		WebKit().unload().run("document.documentElement.outerHTML;", function(err, html) {
			expect(err).to.not.be.ok();
			expect(html).to.be('<html><head></head><body></body></html>');
			expect(this.uri).to.be("");
			done();
		});
	});

	it("should allow chaining load-unload-load", function(done) {
		this.timeout(10000);
		var v = WebKit().load('http://google.com', function(err) {
			expect(err).to.not.be.ok();
		});
		v.unload(function(err) {
			expect(err).to.not.be.ok();
		}).run('document.documentElement.outerHTML', function(err, html, cb) {
			expect(html).to.be("<html><head></head><body></body></html>");
			cb();
		});
		v.load('http://www.selmer.fr', function(err) {
			expect(err).to.not.be.ok();
		}).html(function(err, html) {
			done();
		});
	});

	it("should remove all listeners and not fail on next load", function(done) {
		this.timeout(10000);
		var v = new WebKit();
		v.init(0, function(err) {
			v.load('http://google.com', {allow: "none"});
			v.on('ready', function() {
				v.unload(function(err) {
					v.removeAllListeners();
					v.load('http://github.com', {allow:"none"});
					v.on('ready', function() {
						done();
					});
				});
			});
		});
	});
});
