#include "runnable.h"

Runnable::Runnable(void* view) {
  state = 0;
  sync = false;
  this->view = view;
}

Runnable::~Runnable() {
  delete ticket;
  delete callback;
  delete script;
  delete finish;
}

