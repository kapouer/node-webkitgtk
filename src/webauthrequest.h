#ifndef WEBKITGTK_AUTHREQUEST_H
#define WEBKITGTK_AUTHREQUEST_H

#include <node.h>
#include <webkit2/webkit2.h>
#include <nan.h>
#include "utils.h"

class WebAuthRequest : public node::ObjectWrap {
public:
	static Nan::Persistent<v8::FunctionTemplate> constructor;
	static void Init(v8::Local<v8::Object>);
	static NAN_METHOD(New);

	WebKitAuthenticationRequest* request = NULL;

	WebAuthRequest();
	void init(WebKitAuthenticationRequest*);

private:
	~WebAuthRequest();

	static NAN_GETTER(get_prop);

	static NAN_METHOD(Use);
	static NAN_METHOD(Ignore);
};

#endif
