#include "webauthrequest.h"


using namespace v8;

Persistent<FunctionTemplate> WebAuthRequest::constructor;

WebAuthRequest::WebAuthRequest() {}

WebAuthRequest::~WebAuthRequest() {}

void WebAuthRequest::init(WebKitAuthenticationRequest* request) {
	this->request = request;
	g_object_ref(request);
}

void WebAuthRequest::Init(Handle<Object> target) {
	NanScope();

	Local<FunctionTemplate> tpl = NanNew<FunctionTemplate>(WebAuthRequest::New);
	tpl->InstanceTemplate()->SetInternalFieldCount(1);
	tpl->SetClassName(NanNew("WebAuthRequest"));

	ATTR(tpl, "host", get_prop, NULL);
	ATTR(tpl, "port", get_prop, NULL);
	ATTR(tpl, "realm", get_prop, NULL);

	NODE_SET_PROTOTYPE_METHOD(tpl, "use", WebAuthRequest::Use);
	NODE_SET_PROTOTYPE_METHOD(tpl, "ignore", WebAuthRequest::Ignore);

	target->Set(NanNew("WebAuthRequest"), tpl->GetFunction());
	NanAssignPersistent(constructor, tpl);
}

NAN_METHOD(WebAuthRequest::New) {
	NanScope();
	WebAuthRequest* self = new WebAuthRequest();
	self->Wrap(args.This());
	NanReturnValue(args.This());
}

NAN_METHOD(WebAuthRequest::Use) {
	NanScope();
	WebAuthRequest* self = ObjectWrap::Unwrap<WebAuthRequest>(args.This());
	if (self->request == NULL) {
		NanThrowError("auth request is invalid, use or ignore has already been called");
		NanReturnUndefined();
	}
	if (!args[0]->IsString() || !args[1]->IsString()) {
		NanThrowError("request.use(username, password) expects arguments of type string");
		NanReturnUndefined();
	}
	NanUtf8String* username = new NanUtf8String(args[0]);
	NanUtf8String* password = new NanUtf8String(args[1]);
	WebKitCredential* creds = webkit_credential_new(**username, **password, WEBKIT_CREDENTIAL_PERSISTENCE_FOR_SESSION);
	webkit_authentication_request_authenticate(self->request, creds);
	webkit_credential_free(creds);
	g_object_unref(self->request);
	self->request = NULL;
	NanReturnUndefined();
}

NAN_METHOD(WebAuthRequest::Ignore) {
	NanScope();
	WebAuthRequest* self = ObjectWrap::Unwrap<WebAuthRequest>(args.This());
	if (self->request == NULL) {
		NanThrowError("auth request is invalid, use or ignore has already been called");
		NanReturnUndefined();
	}
	webkit_authentication_request_authenticate(self->request, NULL);
	self->request = NULL;
	NanReturnUndefined();
}

NAN_GETTER(WebAuthRequest::get_prop) {
	NanScope();
	WebAuthRequest* self = node::ObjectWrap::Unwrap<WebAuthRequest>(args.Holder());
	if (self->request == NULL) {
		NanThrowError("auth request is invalid, use or ignore has already been called");
		NanReturnUndefined();
	}
	std::string propstr = TOSTR(property);

	if (propstr == "host") {
		NanReturnValue(NanNew<String>(webkit_authentication_request_get_host(self->request)));
	} else if (propstr == "port") {
		NanReturnValue(NanNew<Integer>(webkit_authentication_request_get_port(self->request)));
	} else if (propstr == "realm") {
		NanReturnValue(NanNew<String>(webkit_authentication_request_get_realm(self->request)));
	}
	NanReturnUndefined();
}
