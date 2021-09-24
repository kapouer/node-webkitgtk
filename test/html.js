const WebKit = require('../');
const expect = require('expect.js');

describe("html method", () => {
	it("should return document html when dom is ready", function(done) {
		this.timeout(10000);
		WebKit.load("http://google.fr").once('ready', function() {
			this.html((err, html) => {
				expect(err).to.not.be.ok();
				expect(html.length).to.be.greaterThan(10000);
				expect(html.split('\n')[0].toLowerCase()).to.be('<!doctype html>');
				done();
			});
		});
	});

	it("should have the XHTML doctype", (done) => {
		const doctype = '<!DOCTYPE html \
		PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" \
		"http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd"\
		>';
		WebKit.load("http://localhost", {content:doctype + '\n<html></html>'}).once('ready', function() {
			this.html((err, html) => {
				expect(err).to.not.be.ok();
				expect(html.split('\n')[0]).to.be(doctype.replace(/\t|\n/g, ""));
				done();
			});
		});
	});

	it("should have no doctype", (done) => {
		const content = '<html><head></head><body></body></html>';
		WebKit.load("http://localhost", {content:content}).once('ready', function() {
			this.html((err, html) => {
				expect(err).to.not.be.ok();
				expect(html).to.be(content);
				done();
			});
		});
	});
});
