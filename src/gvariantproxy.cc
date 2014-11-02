#include "gvariantproxy.h"


using namespace v8;

Persistent<FunctionTemplate> GVariantProxy::constructor;

GVariantProxy::GVariantProxy() {
}

GVariantProxy::~GVariantProxy() {
  if (dict != NULL) {
    g_variant_dict_unref(dict);
    g_variant_unref(variant);
    dict = NULL;
    variant = NULL;
  }
}

void GVariantProxy::init(GVariant* var) {
  variant = var;
  dict = g_variant_dict_new(variant);
}

static bool PropertyNamedAccessCheck(Local<Object>, Local<Value>, AccessType, Local<Value>) {
  return true;
}
static bool PropertyIndexedAccessCheck(Local<Object>, uint32_t, AccessType, Local<Value>) {
  return false;
}

static NAN_PROPERTY_GETTER(GetNamedProperty) {
  NanScope();
  GVariantProxy* self = node::ObjectWrap::Unwrap<GVariantProxy>(args.Holder());
  const gchar* val;
  if (self->dict != NULL) {
    NanUtf8String* prop = new NanUtf8String(property->ToString());
    if (!g_variant_dict_lookup(self->dict, **prop, "s", &val)) val = NULL;
    delete prop;
  }
  if (val == NULL) NanReturnUndefined();
  else NanReturnValue(NanNew<String>(val));
}
static NAN_PROPERTY_SETTER(SetNamedProperty) {
  NanScope();
  GVariantProxy* self = node::ObjectWrap::Unwrap<GVariantProxy>(args.Holder());
  if (self->dict == NULL) NanReturnUndefined();
  NanUtf8String* prop = new NanUtf8String(property->ToString());
  NanUtf8String* val = new NanUtf8String(value->ToString());
  gchar* valstr = NULL;
  if (!value->IsUndefined() && !value->IsNull()) {
    valstr = **val;
  }
  g_variant_dict_insert(self->dict, **prop, "s", valstr);
  delete val;
  delete prop;
  NanReturnUndefined();
}
static NAN_PROPERTY_QUERY(QueryNamedProperty) {
  NanScope();
  gboolean hasProp = FALSE;
  GVariantProxy* self = node::ObjectWrap::Unwrap<GVariantProxy>(args.Holder());
  if (self->dict != NULL) {
    NanUtf8String* prop = new NanUtf8String(property->ToString());
    hasProp = g_variant_dict_contains(self->dict, **prop);
    delete prop;
  }
  NanReturnValue(NanNew<Integer>(hasProp));
}
static NAN_PROPERTY_DELETER(DeleteNamedProperty) {
  NanScope();
  bool hasProp = FALSE;
  GVariantProxy* self = node::ObjectWrap::Unwrap<GVariantProxy>(args.Holder());
  NanUtf8String* prop = NULL;
  if (self->dict != NULL) {
    prop = new NanUtf8String(property->ToString());
    hasProp = g_variant_dict_contains(self->dict, **prop);
  }
  if (hasProp) {
    const gchar* stub = NULL;
    g_variant_dict_insert(self->dict, **prop, "s", &stub);
  }
  if (prop != NULL) delete prop;
  NanReturnValue(NanNew<Boolean>(hasProp));
}
static NAN_PROPERTY_ENUMERATOR(EnumerateNamedProperties) {
  NanScope();
  Handle<Array> array = NanNew<Array>();
  GVariantProxy* self = node::ObjectWrap::Unwrap<GVariantProxy>(args.Holder());
  if (self->dict == NULL) NanReturnValue(array);
  GVariantIter iter;
  GVariant* val;
  gchar* key;
  g_variant_iter_init(&iter, self->variant);
  int i = 0;
  while (g_variant_iter_next(&iter, "{sv}", &key, &val)) {
    if (!g_strcmp0(key, "uri")) continue;
    array->Set(Number::New(i++), NanNew<String>(key));
    g_free(key);
  }
  NanReturnValue(array);
}

void GVariantProxy::Init(Handle<Object> target) {
  NanScope();
  Local<FunctionTemplate> tpl = NanNew<FunctionTemplate>(GVariantProxy::New);
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
  tpl->SetClassName(NanNew("GVariantProxy"));
  target->Set(NanNew("GVariantProxy"), tpl->GetFunction());
  NanAssignPersistent(constructor, tpl);
}

NAN_METHOD(GVariantProxy::New) {
  NanScope();
  GVariantProxy* self = new GVariantProxy();
  self->Wrap(args.This());
  NanReturnValue(args.This());
}
