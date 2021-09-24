const WebKit = require('../');
const expect = require('expect.js');

describe("uri property", () => {
	it("should be undefined before initialization and before load", () => {
		const view = new WebKit();
		expect(view.uri).to.be(undefined);
	});
	it("should be undefined after initialization and before load", (done) => {
		WebKit((err, w) => {
			expect(w.uri).to.be(undefined);
			done();
		});
	});
	it("should add a trailing slash - not that it matters but it's a sign it works", (done) => {
		const uri = 'http://localhost';
		WebKit.load(uri, (err, w) => {
			expect(w.uri).to.be(uri + '/');
			done();
		});
	});
});
