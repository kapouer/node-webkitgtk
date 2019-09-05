#include "webauthrequest.h"


using namespace v8;

Nan::Persistent<FunctionTemplate> WebAuthRequest::constructor;

WebAuthRequest::WebAuthRequest() {}

WebAuthRequest::~WebAuthRequest() {}

void WebAuthRequest::init(WebKitAuthenticationRequest* request) {
	this->request = request;
	g_object_ref(request);
}

void WebAuthRequest::Init(Local<Object> target) {
	Nan::HandleScope scope;

	Local<FunctionTemplate> tpl = Nan::New<FunctionTemplate>(WebAuthRequest::New);
	tpl->InstanceTemplate()->SetInternalFieldCount(1);
	tpl->SetClassName(Nan::New("WebAuthRequest").ToLocalChecked());

	ATTR(tpl, "host", get_prop, NULL);
	ATTR(tpl, "port", get_prop, NULL);
	ATTR(tpl, "realm", get_prop, NULL);

	Nan::SetPrototypeMethod(tpl, "use", WebAuthRequest::Use);
	Nan::SetPrototypeMethod(tpl, "ignore", WebAuthRequest::Ignore);

	target->Set(Nan::New("WebAuthRequest").ToLocalChecked(), tpl->GetFunction());
	constructor.Reset(tpl);
}

NAN_METHOD(WebAuthRequest::New) {
	Nan::HandleScope scope;
	WebAuthRequest* self = new WebAuthRequest();
	self->Wrap(info.This());
	info.GetReturnValue().Set(info.This());
}

NAN_METHOD(WebAuthRequest::Use) {
	Nan::HandleScope scope;
	WebAuthRequest* self = ObjectWrap::Unwrap<WebAuthRequest>(info.This());
	if (self->request == NULL) {
		Nan::ThrowError("auth request is invalid, use or ignore has already been called");
		return;
	}
	if (!info[0]->IsString() || !info[1]->IsString()) {
		Nan::ThrowError("request.use(username, password) expects arguments of type string");
		return;
	}
	Nan::Utf8String* username = new Nan::Utf8String(info[0]);
	Nan::Utf8String* password = new Nan::Utf8String(info[1]);
	WebKitCredential* creds = webkit_credential_new(**username, **password, WEBKIT_CREDENTIAL_PERSISTENCE_FOR_SESSION);
	webkit_authentication_request_authenticate(self->request, creds);
	webkit_credential_free(creds);
	g_object_unref(self->request);
	self->request = NULL;
	return;
}

NAN_METHOD(WebAuthRequest::Ignore) {
	Nan::HandleScope scope;
	WebAuthRequest* self = ObjectWrap::Unwrap<WebAuthRequest>(info.This());
	if (self->request == NULL) {
		Nan::ThrowError("auth request is invalid, use or ignore has already been called");
		return;
	}
	webkit_authentication_request_authenticate(self->request, NULL);
	self->request = NULL;
	return;
}

NAN_GETTER(WebAuthRequest::get_prop) {
	Nan::HandleScope scope;
	WebAuthRequest* self = node::ObjectWrap::Unwrap<WebAuthRequest>(info.Holder());
	if (self->request == NULL) {
		Nan::ThrowError("auth request is invalid, use or ignore has already been called");
		return;
	}
	std::string propstr = TOSTR(property);

	if (propstr == "host") {
		info.GetReturnValue().Set(Nan::New<String>(webkit_authentication_request_get_host(self->request)).ToLocalChecked());
	} else if (propstr == "port") {
		info.GetReturnValue().Set(Nan::New<Integer>(webkit_authentication_request_get_port(self->request)));
	} else if (propstr == "realm") {
		info.GetReturnValue().Set(Nan::New<String>(webkit_authentication_request_get_realm(self->request)).ToLocalChecked());
	}
	return;
}
