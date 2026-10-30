export const callerTraceManifest={
  "fulfillment/FulfillmentAllocationService.js": {
    "sha256": "32039f6e93e19742354273bdf92e78c2ca6f82076a8d3acb7adb168384cdfffd",
    "targets": {
      "saveReleasedProjections": {
        "label": "F_RELEASE_PROJECTIONS",
        "nodeType": "MethodDefinition",
        "className": "FulfillmentAllocationService",
        "private": true,
        "async": true
      },
      "saveAllocationProjections": {
        "label": "F_SAVE_PROJECTIONS",
        "nodeType": "MethodDefinition",
        "className": "FulfillmentAllocationService",
        "private": true,
        "async": true
      },
      "saveSequenceAudits": {
        "label": "F_SEQUENCE_AUDITS",
        "nodeType": "MethodDefinition",
        "className": "FulfillmentAllocationService",
        "private": true,
        "async": true
      }
    }
  },
  "fulfillment/fulfillmentAllocationReceipt.js": {
    "sha256": "1baf376dc9dddaa7c996c67cc372c2e122f548b01ccd96add890962ed0faaf21",
    "targets": {
      "fulfillmentReallocationProjectionRows": {
        "label": "F_DECODE_REALLOCATION",
        "nodeType": "FunctionDeclaration"
      },
      "fulfillmentAllocationProjectionRows": {
        "label": "F_DECODE_NEW_ROWS",
        "nodeType": "FunctionDeclaration"
      },
      "assertReallocationOwnerStates": {
        "label": "F_ASSERT_OWNER",
        "nodeType": "FunctionDeclaration"
      }
    }
  },
  "fulfillment/fulfillmentAllocationScope.js": {
    "sha256": "044742785336f13ed1619d629ce2fe81b1f74c0e00adfeaf966d74702c5f5db2",
    "targets": {
      "assertAllocationSourceFacts": {
        "label": "F_ASSERT_SOURCE",
        "nodeType": "FunctionDeclaration"
      }
    }
  },
  "fulfillment/FulfillmentOperationService.js": {
    "sha256": "4c2993cebf1448316367ee717bfc5f5f0386f79ce358c1589c2ebe6534248512",
    "targets": {
      "complete": {
        "label": "F_OPERATION_COMPLETE_ASYNC",
        "nodeType": "MethodDefinition",
        "className": "FulfillmentOperationService",
        "private": true,
        "async": true
      }
    }
  },
  "inventory/InventoryLookupService.js": {
    "sha256": "d1f51f22ae7ec9ac79aa40c5bb01208886523734fa5380a40a849be79967c575",
    "targets": {
      "lockFulfillmentReservationStatesInTransaction": {
        "label": "F_RESERVATION_CURRENT",
        "nodeType": "MethodDefinition",
        "className": "InventoryLookupService",
        "private": false,
        "async": true
      },
      "readFulfillmentReallocationStatesInTransaction": {
        "label": "F_OWNER_CURRENT",
        "nodeType": "MethodDefinition",
        "className": "InventoryLookupService",
        "private": false,
        "async": true
      }
    }
  }
};
