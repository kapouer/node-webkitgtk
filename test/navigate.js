const WebKit = require('../');
const expect = require('expect.js');

// TODO
// navigation screws page lifecycle events
//

describe("navigation", () => {
	it("should emit navigate event when navigation is true and allow redirection", (done) => {
		let counter = 0;
		let navcount = 0;
		const server = require('http').createServer((req, res) => {
			res.statusCode = 200;
			res.end("ok" + counter++);
		}).listen(() => {
			WebKit.load("http://localhost:" + server.address().port, {
				navigation: true
			}, (err, w) => {
				w.run((done) => {
					document.location = '/anotherpage';
					done();
				}, () => {
					setTimeout(() => {
						server.close();
						expect(counter).to.be(2);
						expect(navcount).to.be(1);
						done();
					}, 100);
				});
			}).on('navigate', function(url) {
				navcount++;
				expect(url).to.be(this.uri + 'anotherpage');
			});
		});
	});
	it("should emit navigate event when navigation is false and disallow redirection", (done) => {
		let counter = 0;
		let navcount = 0;
		const server = require('http').createServer((req, res) => {
			res.statusCode = 200;
			if (req.url == "/") {
				counter++;
				res.end(`
					<html><body>
					<script type="text/javascript" src="/delay.js"></script>
					<script type="text/javascript">
					document.location = "/anotherpage";
					</script>
					</body></html>
				`);
			} else if (req.url == "/anotherpage") {
				counter++;
				res.end("ok" + counter++);
			} else if (req.url == "/delay.js") {
				setTimeout(() => {
					res.end("console.log('delayed');");
				}, 500);
			}
		}).listen(() => {
			WebKit.load("http://localhost:" + server.address().port, {
				navigation: false
			}).on('navigate', function(url) {
				navcount++;
				expect(url).to.be(this.uri + 'anotherpage');
			}).when('idle', (cb) => {
				expect(counter).to.be(1);
				expect(navcount).to.be(1);
				cb();
				server.close();
				done();
			});
		});
	});
});
