var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("html method", function suite() {
	it("should return document html when dom is ready", function(done) {
		this.timeout(10000);
		WebKit().load("http://google.fr").wait('ready').html(function(err, html) {
			expect(err).to.not.be.ok();
			expect(html.length).to.be.greaterThan(10000);
			done();
		});
	});
});
