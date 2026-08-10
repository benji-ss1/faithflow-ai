// shim.c — forces the CNDI umbrella header to compile as part of the target.
// We dynamically load the NDI runtime at runtime (dlopen + NDIlib_v5_load),
// so there is no link-time dependency on libndi and nothing else to do here.
#include "CNDI.h"
