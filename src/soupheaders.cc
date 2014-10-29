#include "soupheaders.h"


using namespace v8;

Persistent<FunctionTemplate> SoupHeaders::constructor;

SoupHeaders::SoupHeaders() {}

SoupHeaders::~SoupHeaders() {
  headers = NULL;
}

void SoupHeaders::init(SoupMessageHeaders* headers) {
  this->headers = headers;
}

static bool PropertyNamedAccessCheck(Local<Object>, Local<Value>, AccessType, Local<Value>) {
  return true;
}
static bool PropertyIndexedAccessCheck(Local<Object>, uint32_t, AccessType, Local<Value>) {
  return false;
}

static NAN_PROPERTY_GETTER(GetNamedProperty) {
  NanScope();
  const char* headerList = NULL;
  SoupHeaders* self = node::ObjectWrap::Unwrap<SoupHeaders>(args.Holder());
  if (self->headers != NULL) {
    NanUtf8String* prop = new NanUtf8String(property->ToString());
    headerList = soup_message_headers_get_list(self->headers, **prop);
    delete prop;
  }
  if (headerList == NULL) NanReturnUndefined();
  else NanReturnValue(NanNew<String>(headerList));
}
static NAN_PROPERTY_SETTER(SetNamedProperty) {
  NanScope();
  SoupHeaders* self = node::ObjectWrap::Unwrap<SoupHeaders>(args.Holder());
  if (self->headers == NULL) NanReturnUndefined();
  NanUtf8String* prop = new NanUtf8String(property->ToString());
  NanUtf8String* val = new NanUtf8String(value->ToString());
  soup_message_headers_replace(self->headers, **prop, **val);
  delete prop;
  delete val;
  NanReturnUndefined();
}
static NAN_PROPERTY_QUERY(QueryNamedProperty) {
  NanScope();
  const char* headerOne = NULL;
  SoupHeaders* self = node::ObjectWrap::Unwrap<SoupHeaders>(args.Holder());
  if (self->headers != NULL) {
    NanUtf8String* prop = new NanUtf8String(property->ToString());
    headerOne = soup_message_headers_get_one(self->headers, **prop);
    delete prop;
  }
  if (headerOne == NULL) {
    NanReturnValue(NanNew<Integer>(false));
  } else {
    NanReturnValue(NanNew<Integer>(true));
  }
}
static NAN_PROPERTY_DELETER(DeleteNamedProperty) {
  NanScope();
  const char* headerOne = NULL;
  SoupHeaders* self = node::ObjectWrap::Unwrap<SoupHeaders>(args.Holder());
  NanUtf8String* prop = NULL;
  if (self->headers != NULL) {
    prop = new NanUtf8String(property->ToString());
    headerOne = soup_message_headers_get_one(self->headers, **prop);
  }
  if (headerOne == NULL) {
    if (prop != NULL) delete prop;
    NanReturnValue(NanNew<Boolean>(false));
  } else {
    soup_message_headers_remove(self->headers, **prop);
    delete prop;
    NanReturnValue(NanNew<Boolean>(true));
  }
}
static NAN_PROPERTY_ENUMERATOR(EnumerateNamedProperties) {
  NanScope();
  Handle<Array> array = NanNew<Array>();
  SoupHeaders* self = node::ObjectWrap::Unwrap<SoupHeaders>(args.Holder());
  if (self->headers == NULL) NanReturnValue(array);
  SoupMessageHeadersIter iter;
  soup_message_headers_iter_init(&iter, self->headers);
  int i = 0;
  while (true) {
    const char* name;
    const char* value;
    if (!soup_message_headers_iter_next(&iter, &name, &value)) break;
    array->Set(Number::New(i++), NanNew<String>(name));
  }
  NanReturnValue(array);
}

void SoupHeaders::Init(Handle<Object> target) {
  NanScope();
  Local<FunctionTemplate> tpl = NanNew<FunctionTemplate>(SoupHeaders::New);
  Local<ObjectTemplate> otmpl = tpl->InstanceTemplate();
  otmpl->SetInternalFieldCount(1);

  otmpl->SetNamedPropertyHandler(
    GetNamedProperty,
    SetNamedProperty,
    QueryNamedProperty,
    DeleteNamedProperty,
    EnumerateNamedProperties
  );
  otmpl->SetAccessCheckCallbacks(
    PropertyNamedAccessCheck,
    PropertyIndexedAccessCheck
  );
  tpl->SetClassName(NanNew("SoupHeaders"));
  target->Set(NanNew("SoupHeaders"), tpl->GetFunction());
  NanAssignPersistent(constructor, tpl);
}

NAN_METHOD(SoupHeaders::New) {
  NanScope();
  SoupHeaders* self = new SoupHeaders();
  self->Wrap(args.This());
  NanReturnValue(args.This());
}
