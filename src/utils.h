#ifndef WEBKITGTK_UTILS_H
#define WEBKITGTK_UTILS_H

#define ATTR(t, name, get, set) t->InstanceTemplate()->SetAccessor(NanNew(name), get, set);
#define TOSTR(obj) (*String::Utf8Value((obj)->ToString()))
#define H(name) NanNew<String>(name)

#include <nan.h>
#include <glib.h>
#include <soup.h>

using namespace v8;

gchar* getStr(Handle<Object>, const gchar*);
NanCallback* getCb(Handle<Object>, const gchar*);
void update_soup_headers_with_dict(SoupMessageHeaders*, GVariant*);
GVariant* soup_headers_to_gvariant_dict(SoupMessageHeaders*);

#endif

