module.exports = class AuthRequest {
	constructor(req, res) {
		this.req = req;
		this.host = req.uri.hostname;
		this.port = parseInt(req.uri.port);
		const header = res.headers['www-authenticate'];
		const realMatch = header ? /realm="(\w+)"/.exec(header) : null;
		this.realm = realMatch && realMatch[1] || null;
	}

	use(user, pass, realm) {
		this.req.auth(user, pass, false, realm);
	}

	ignore() {
		// this is the default behavior anyway
	}
};
