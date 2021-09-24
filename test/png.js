const WebKit = require('../');
const expect = require('expect.js');
const fs = require('fs');

describe("png method", () => {
	it("should wait for load event and save a screenshot to disk", function(done) {
		this.timeout(10000);
		const filepath = __dirname + '/shots/test.png';
		WebKit((err, w) => {
			w.load("https://www.debian.org/").once('load', function() {
				this.png(filepath, (err) => {
					expect(err).to.not.be.ok();
					fs.stat(filepath, (err, stat) => {
						expect(stat.size).to.be.above(50000);
						done();
					});
				});
			});
		});
	});

	it("should save a screenshot to disk", function(done) {
		this.timeout(10000);
		const filepath = __dirname + '/shots/test2.png';
		WebKit((err, w) => {
			w.load("https://www.debian.org/", {
				width: 512,
				height: 512,
				style: fs.readFileSync(__dirname + "/../css/png.css")
			}, (err) => {
				expect(err).to.not.be.ok();
			}).on("request", (req) => {
				if (/\.js$/.test(req.uri)) req.uri = null;
			}).once("load", function() {
				this.png(filepath, (err) => {
					expect(err).to.not.be.ok();
					fs.stat(filepath, (err, stat) => {
						expect(stat.size).to.be.above(30000);
						done();
					});
				});
			});
		});
	});

	it("should not crash when calling png right now and twice in a row", (done) => {
		const w = new WebKit();
		w.init(() => {
			w.load('https://www.debian.org').once('load', () => {
				let count = 0;
				// this won't even generate a png since no surface is yet acquired
				w.png(__dirname + '/shots/testr1.png', (err) => {
					expect(err).to.not.be.ok();
					expect(count).to.be(1);
					done();
				});
				let ex;
				try {
					w.png(__dirname + '/shots/testr2.png', (err) => {
						expect(true).to.be(false);
					});
				} catch(e) {
					ex = e;
				}
				expect(ex).to.be.ok();
				count++;
			});
		});
	});

	it("should error out when called before document and is loaded", (done) => {
		const w = new WebKit();
		w.init(() => {
			w.load('https://www.debian.org');
			// this may won't even generate a png since no surface is yet acquired
			const pngFile = __dirname + '/shots/testr1err.png';
			w.png(pngFile, (err) => {
				require('fs').access(pngFile, (errStat) => {
					if (errStat) {
						// no file so an error happened
						expect(err).to.be.ok();
					} else {
						expect(err).to.not.be.ok();
					}
					done();
				});
			});
		});
	});
});

