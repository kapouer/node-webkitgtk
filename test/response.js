const WebKit = require('../');
const expect = require('expect.js');

describe("response handler data method", () => {
	it("should get data from the response", function(done) {
		this.timeout(5000);
		WebKit.load("https://www.debian.org/logos/openlogo-nd-100.png")
			.on("response", function(response) {
				if (response.uri == this.uri) {
					response.data((err, data) => {
						expect(data.slice(1, 4).toString()).to.be("PNG");
						expect(data.length).to.be.greaterThan(1000);
						done();
					});
				}
			});
	});
	it("should get headers from the response", function(done) {
		this.timeout(5000);
		WebKit.load("https://www.debian.org/logos/openlogo-nd-100.png").on("response", function(response) {
			if (response.uri == this.uri) {
				expect(response.headers['Content-Type']).to.be('image/png');
				expect(Object.keys(response.headers).length).to.be.greaterThan(3);
				done();
			}
		});
	});
	it("should get length status mime and filename from the response", function(done) {
		this.timeout(5000);
		WebKit.load("https://www.debian.org/logos/openlogo-nd-100.png").on("response", function(response) {
			if (response.uri == this.uri) {
				expect(response.mime).to.be('image/png');
				expect(response.status).to.be(200);
				expect(response.filename).to.not.be.ok();
				expect(response.length).to.be.greaterThan(1000);
				done();
			}
		});
	});
	it("should get data event with mime, status, length, clength", function(done) {
		this.timeout(6000);
		let doc = '<html><head></head><body><img src="thing.png">move along';
		const tail = " - nothing to see</body></html>";
		for (let i = 0; i < 8192; i++) doc += ' ';
		let port;
		let waited = 0;
		setTimeout(() => {
			waited = 1;
		}, 500);
		const server = require('http').createServer((req, res) => {
			res.statusCode = 200;
			res.write(doc);
			setTimeout(() => {
				res.end(tail);
			}, 1000);
		}).listen(() => {
			port = server.address().port;
			const url = "http://localhost:" + port + '/';
			WebKit((err, w) => {
				let count = 0;
				w.on('data', (res) => {
					if (waited == 1) waited = 2;
					count++;
					expect(res.status).to.be(200);
					expect(res.uri).to.be(url);
					expect(res.length).to.be(0);
					expect(res.clength).to.be.greaterThan(10);
					expect(res.clength).to.be.lessThan(doc.length + tail.length);
				});
				w.on('response', () => {
					expect(count).to.be.greaterThan(1);
					expect(waited).to.be(2);
					done();
				});

				w.load(url, {
					"auto-load-images": false
				});
			});
		});
	});
});
