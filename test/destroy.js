var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("destroy method", function suite() {
	it("should be idempotent", function(done) {
		var view = new WebKit();
		view.init(0, function(err) {
			expect(err).to.not.be.ok();
			view.webview.destroy();
			view.webview.destroy();
			done();
		});
	});
});
