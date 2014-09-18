var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("unload method", function suite() {
	this.timeout(10000);
	it("should be set immediately to an empty document with an empty url", function(done) {
		var view = new WebKit();
		var uri = 'http://localhost';
		view.load(uri).once('load', function() {
			view.unload(function(err) {
				expect(view.uri).to.be("");
				expect(view.looping).to.be(0);
				view.run("document.documentElement.outerHTML;", function(err, html) {
					expect(err).to.not.be.ok();
					expect(html).to.be('<html><head></head><body></body></html>');
					done();
				});
			});
		});
	});
	it("should allow to load another uri just after", function(done) {
		var view = new WebKit();
		var uri = 'http://google.com';
		view.load(uri).once('load', function() {
			view.unload(function(err) {
				view.load('http://google.com', function(err) {
					expect(err).to.not.be.ok();
				}).html(function(err, html) {
					expect(err).to.not.be.ok();
					expect(html.length).to.be.greaterThan(200);
					done();
				});
			});
		});
	});
});
