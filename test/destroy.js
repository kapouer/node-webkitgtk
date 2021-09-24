const WebKit = require('../');
const expect = require('expect.js');

describe("destroy method", () => {
	it("should be idempotent", (done) => {
		const view = new WebKit();
		view.init((err) => {
			expect(err).to.not.be.ok();
			view.destroy((err) => {
				expect(err).to.not.be.ok();
				view.destroy(done);
			});
		});
	});
});
