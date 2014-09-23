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
		}).run('document.documentElement.outerHTML', function(err, html) {
			expect(html).to.be("<html><head></head><body></body></html>");
		});
		v.load('http://www.selmer.fr', function(err) {
			expect(err).to.not.be.ok();
		}).html(function(err, html) {
			done();
		});
	});
});
