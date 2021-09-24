const WebKit = require('../');
const expect = require('expect.js');
const path = require('path');

describe("concurrent png calls should not crash", function suite() {
	this.timeout(10000);
	let w;
	before((cb) => {
		w = new WebKit();
		w.init(cb);
	});
	it("first call wrongly assumes idle event is not called", (done) => {
		const href = "https://www.mezilla.org/en-US/";
		const filePath = path.resolve(__dirname, './shots/out1.png');
		w.once('idle', () => {
			w.png(filePath, (err) => {
				expect(err).to.not.be.ok();
			});
		});
		w.load(href, {}, (err) => {
			expect(err).to.be.ok();
			done();
		});
	});
	it("second call calls png actually just after first call and must not crash", (done) => {
		const href = "https://www.google.com";
		const filePath = path.resolve(__dirname, './shots/out2.png');
		w.once('idle', () => {
			try {
				w.png(filePath, (err) => {
					done();
				});
			} catch (e) {
				// pass
			}
		});
		w.load(href, {}, (err) => {
			expect(err).to.not.be.ok();
			setTimeout(done, 1000);
		});
	});
});

