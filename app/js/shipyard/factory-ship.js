angular.module('shipyard').factory('Ship', ['Components', 'calcShieldStrength', 'calcJumpRange', 'calcTotalRange', 'calcSpeed', 'lodash', 'ArmourMultiplier', function(Components, calcShieldStrength, calcJumpRange, calcTotalRange, calcSpeed, _, ArmourMultiplier) {

  /**
   * Returns the power usage type of a slot and it's particular component
   * @param  {object} slot      The Slot
   * @param  {object} component The component in the slot
   * @return {string}           The key for the power usage type
   */
  function powerUsageType(slot, component) {
    if (component) {
      if (component.passive) {
        return 'retracted';
      }
    }
    return slot.cat != 1 ? 'retracted' : 'deployed';
  }

  /**
   * Ship model used to track all ship components and properties.
   *
   * @param {string} id         Unique ship Id / Key
   * @param {object} properties Basic ship properties such as name, manufacturer, mass, etc
   * @param {object} slots      Collection of slot groups (standard/standard, internal, hardpoints) with their max class size.
   */
  function Ship(id, properties, slots) {
    this.id = id;
    this.cargoHatch = { c: Components.cargoHatch(), type: 'SYS' };
    this.bulkheads = { incCost: true, maxClass: 8 };
    this.availCS = Components.forShip(id);

    for (var p in properties) { this[p] = properties[p]; }  // Copy all base properties from shipData

    for (var slotType in slots) {   // Initialize all slots
      var slotGroup = slots[slotType];
      var group = this[slotType] = [];   // Initialize Slot group (Standard, Hardpoints, Internal)
      for (var i = 0; i < slotGroup.length; i++) {
        if (typeof slotGroup[i] == 'object') {
          group.push({ id: null, c: null, incCost: true, maxClass: slotGroup[i].class, eligible: slotGroup[i].eligible });
        } else {
          group.push({ id: null, c: null, incCost: true, maxClass: slotGroup[i] });
        }
      }
    }
    // Make a Ship 'slot'/item similar to other slots
    this.c = { incCost: true, type: 'SHIP', discountedCost: this.hullCost, c: { name: this.name, cost: this.hullCost } };

    this.costList = _.union(this.internal, this.standard, this.hardpoints);
    this.costList.push(this.bulkheads);  // Add The bulkheads
    this.costList.unshift(this.c); // Add the ship itself to the list

    this.powerList = _.union(this.internal, this.hardpoints);
    this.powerList.unshift(this.cargoHatch);
    this.powerList.unshift(this.standard[1]);  // Add Thrusters
    this.powerList.unshift(this.standard[5]);  // Add Sensors
    this.powerList.unshift(this.standard[4]);  // Add Power Distributor
    this.powerList.unshift(this.standard[3]);  // Add Life Support
    this.powerList.unshift(this.standard[2]);  // Add FSD
    this.powerList.unshift(this.standard[0]);  // Add Power Plant

    this.shipCostMultiplier = 1;
    this.componentCostMultiplier = 1;

    this.priorityBands = [
      { deployed: 0, retracted: 0, retOnly: 0 },
      { deployed: 0, retracted: 0, retOnly: 0 },
      { deployed: 0, retracted: 0, retOnly: 0 },
      { deployed: 0, retracted: 0, retOnly: 0 },
      { deployed: 0, retracted: 0, retOnly: 0 }
    ];
  }

  //*********//
  // GETTERS //
  //*********//

  Ship.prototype.getAvailableComponents = function() {
    return this.availCS;
  };

  Ship.prototype.getSlotStatus = function(slot, deployed) {
    if (!slot.c) { // Empty Slot
      return 0;   // No Status (Not possible to be active in this state)
    } else if (!slot.enabled) {
      return 1;   // Disabled
    } else if (deployed) {
      return this.priorityBands[slot.priority].deployedSum >= this.powerAvailable ? 2 : 3; // Offline : Online
      // Active hardpoints have no retracted status
    } else if ((slot.cat === 1 && !slot.c.passive)) {
      return 0;  // No Status (Not possible to be active in this state)
    }
    return this.priorityBands[slot.priority].retractedSum >= this.powerAvailable ? 2 : 3;    // Offline : Online
  };

/**
   * Calculate jump range using the installed FSD and the
   * specified mass which can be more or less than ships actual mass
   * @param  {number} mass Mass in tons
   * @param  {number} fuel Fuel available in tons
   * @return {number}      Jump range in Light Years
   */
  Ship.prototype.getJumpRangeForMass = function(mass, fuel) {
    return calcJumpRange(mass, this.standard[2].c, fuel);
  };

  /**
   * Find an internal slot that has an installed component of the specific group.
   *
   * @param  {string} group Component group/type
   * @return {number}       The index of the slot in ship.internal
   */
  Ship.prototype.findInternalByGroup = function(group) {
    var index;
    if (group == 'sg' || group == 'psg') {
      index = _.findIndex(this.internal, function(slot) {
        return slot.c && (slot.c.grp == 'sg' || slot.c.grp == 'psg');
      });
    } else {
      index = _.findIndex(this.internal, function(slot) {
        return slot.c && slot.c.grp == group;
      });
    }

    if (index !== -1) {
      return this.internal[index];
    }
    return null;
  };

  //**********************//
  // Mutate / Update Ship //
  //**********************//

  /**
   * Recalculate all item costs and total based on discounts.
   * @param  {number} shipCostMultiplier      Ship cost multiplier discount (e.g. 0.9 === 10% discount)
   * @param  {number} componentCostMultiplier Component cost multiplier discount (e.g. 0.75 === 25% discount)
   */
  Ship.prototype.applyDiscounts = function(shipCostMultiplier, componentCostMultiplier) {
    var total = 0;
    var costList = this.costList;

    for (var i = 0, l = costList.length; i < l; i++) {
      var item = costList[i];
      if (item.c && item.c.cost) {
        item.discountedCost = item.c.cost * (item.type == 'SHIP' ? shipCostMultiplier : componentCostMultiplier);
        if (item.incCost) {
          total += item.discountedCost;
        }
      }
    }
    this.shipCostMultiplier = shipCostMultiplier;
    this.componentCostMultiplier = componentCostMultiplier;
    this.totalCost = total;
    return this;
  };

  /**
   * Builds/Updates the ship instance with the components[comps] passed in.
   * @param {object} comps Collection of components used to build the ship
   */
  Ship.prototype.buildWith = function(comps, priorities, enabled) {
    var internal = this.internal,
        standard = this.standard,
        hps = this.hardpoints,
        bands = this.priorityBands,
        cl = standard.length,
        i, l;

    // Reset Cumulative stats
    this.fuelCapacity = 0;
    this.cargoCapacity = 0;
    this.ladenMass = 0;
    this.armourAdded = 0;
    this.armourMultiplier = 1;
    this.shieldMultiplier = 1;
    this.totalCost = this.c.incCost ? this.c.discountedCost : 0;
    this.unladenMass = this.hullMass;
    this.totalDps = 0;

    this.bulkheads.c = null;
    this.useBulkhead(comps && comps.bulkheads ? comps.bulkheads : 0, true);
    this.cargoHatch.priority = priorities ? priorities[0] * 1 : 0;
    this.cargoHatch.enabled = enabled ? enabled[0] * 1 : true;

    for (i = 0, l = this.priorityBands.length; i < l; i++) {
      this.priorityBands[i].deployed = 0;
      this.priorityBands[i].retracted = 0;
      this.priorityBands[i].retOnly = 0;
    }

    if (this.cargoHatch.enabled) {
      bands[this.cargoHatch.priority].retracted += this.cargoHatch.c.power;
    }

    for (i = 0; i < cl; i++) {
      standard[i].cat = 0;
      standard[i].enabled = enabled ? enabled[i + 1] * 1 : true;
      standard[i].priority = priorities && priorities[i + 1] ? priorities[i + 1] * 1 : 0;
      standard[i].type = 'SYS';
      standard[i].c = standard[i].id = null; // Resetting 'old' component if there was one
      standard[i].discountedCost = 0;

      if (comps) {
        this.use(standard[i], comps.standard[i], Components.standard(i, comps.standard[i]), true);
      }
    }

    standard[1].type = 'ENG'; // Thrusters
    standard[2].type = 'ENG'; // FSD
    cl++; // Increase accounts for Cargo Scoop

    for (i = 0, l = hps.length; i < l; i++) {
      hps[i].cat = 1;
      hps[i].enabled = enabled ? enabled[cl + i] * 1 : true;
      hps[i].priority = priorities && priorities[cl + i] ? priorities[cl + i] * 1 : 0;
      hps[i].type = hps[i].maxClass ? 'WEP' : 'SYS';
      hps[i].c = hps[i].id = null; // Resetting 'old' component if there was one
      hps[i].discountedCost = 0;

      if (comps && comps.hardpoints[i] !== 0) {
        this.use(hps[i], comps.hardpoints[i], Components.hardpoints(comps.hardpoints[i]), true);
      }
    }

    cl += hps.length; // Increase accounts for hardpoints

    for (i = 0, l = internal.length; i < l; i++) {
      internal[i].cat = 2;
      internal[i].enabled = enabled ? enabled[cl + i] * 1 : true;
      internal[i].priority = priorities && priorities[cl + i] ? priorities[cl + i] * 1 : 0;
      internal[i].type = 'SYS';
      internal[i].id = internal[i].c = null; // Resetting 'old' component if there was one
      internal[i].discountedCost = 0;

      if (comps && comps.internal[i] !== 0) {
        this.use(internal[i], comps.internal[i], Components.internal(comps.internal[i]), true);
      }
    }

    // Update aggragated stats
    if (comps) {
      this.updatePower()
          .updateJumpStats()
          .updateShieldStrength()
          .updateTopSpeed();
    }

    return this;
  };

  Ship.prototype.emptyHardpoints = function() {
    for (var i = this.hardpoints.length; i--; ) {
      this.use(this.hardpoints[i], null, null);
    }
    return this;
  };

  Ship.prototype.emptyInternal = function() {
    for (var i = this.internal.length; i--; ) {
      this.use(this.internal[i], null, null);
    }
    return this;
  };

  Ship.prototype.emptyUtility = function() {
    for (var i = this.hardpoints.length; i--; ) {
      if (!this.hardpoints[i].maxClass) {
        this.use(this.hardpoints[i], null, null);
      }
    }
    return this;
  };

  Ship.prototype.emptyWeapons = function() {
    for (var i = this.hardpoints.length; i--; ) {
      if (this.hardpoints[i].maxClass) {
        this.use(this.hardpoints[i], null, null);
      }
    }
    return this;
  };

  /**
   * Optimize for the lower mass build that can still boost and power the ship
   * without power management.
   * @param  {object} c Standard Component overrides
   */
  Ship.prototype.optimizeMass = function(c) {
    return this.emptyHardpoints().emptyInternal().useLightestStandard(c);
  };

  Ship.prototype.setCostIncluded = function(item, included) {
    if (item.incCost != included && item.c) {
      this.totalCost += included ? item.discountedCost : -item.discountedCost;
    }
    item.incCost = included;
    return this;
  };

  Ship.prototype.setSlotEnabled = function(slot, enabled) {
    if (slot.enabled != enabled) { // Enabled state is changing
      slot.enabled = enabled;
      if (slot.c) {
        this.priorityBands[slot.priority][powerUsageType(slot, slot.c)] += enabled ? slot.c.power : -slot.c.power;

        if (slot.c.grp == 'sg' || slot.c.grp == 'psg') {
          this.updateShieldStrength();
        } else if (slot.c.grp == 'sb') {
          this.shieldMultiplier += slot.c.shieldmul * (enabled ? 1 : -1);
          this.updateShieldStrength();
        } else if (slot.c.dps) {
          this.totalDps += slot.c.dps * (enabled ? 1 : -1);
        }

        this.updatePower();
      }
    }
    return this;
  };

  /**
   * Updates the ship's cumulative and aggregated stats based on the component change.
   */
  Ship.prototype.updateStats = function(slot, n, old, preventUpdate) {
    var powerChange = slot == this.standard[0];

    if (old) {  // Old component now being removed
      switch (old.grp) {
        case 'ft':
          this.fuelCapacity -= old.capacity;
          break;
        case 'cr':
          this.cargoCapacity -= old.capacity;
          break;
        case 'hr':
          this.armourAdded -= old.armouradd;
          break;
        case 'sb':
          this.shieldMultiplier -= slot.enabled ? old.shieldmul : 0;
          break;
      }

      if (slot.incCost && old.cost) {
        this.totalCost -= old.cost * this.componentCostMultiplier;
      }

      if (old.power && slot.enabled) {
        this.priorityBands[slot.priority][powerUsageType(slot, old)] -= old.power;
        powerChange = true;

        if (old.dps) {
          this.totalDps -= old.dps;
        }
      }
      this.unladenMass -= old.mass || 0;
    }

    if (n) {
      switch (n.grp) {
        case 'ft':
          this.fuelCapacity += n.capacity;
          break;
        case 'cr':
          this.cargoCapacity += n.capacity;
          break;
        case 'hr':
          this.armourAdded += n.armouradd;
          break;
        case 'sb':
          this.shieldMultiplier += slot.enabled ? n.shieldmul : 0;
          break;
      }

      if (slot.incCost && n.cost) {
        this.totalCost += n.cost * this.componentCostMultiplier;
      }

      if (n.power && slot.enabled) {
        this.priorityBands[slot.priority][powerUsageType(slot, n)] += n.power;
        powerChange = true;

        if (n.dps) {
          this.totalDps += n.dps;
        }
      }
      this.unladenMass += n.mass || 0;
    }

    this.ladenMass = this.unladenMass + this.cargoCapacity + this.fuelCapacity;
    this.armour = this.armourAdded + Math.round(this.baseArmour * this.armourMultiplier);

    if (!preventUpdate) {
      if (powerChange) {
        this.updatePower();
      }
      this.updateTopSpeed();
      this.updateJumpStats();
      this.updateShieldStrength();
    }
    return this;
  };

  Ship.prototype.updatePower = function() {
    var bands = this.priorityBands;
    var prevRetracted = 0, prevDeployed = 0;

    for (var i = 0, l = bands.length; i < l; i++) {
      var band = bands[i];
      prevRetracted = band.retractedSum = prevRetracted + band.retracted + band.retOnly;
      prevDeployed = band.deployedSum = prevDeployed + band.deployed + band.retracted;
    }

    this.powerAvailable = this.standard[0].c.pGen;
    this.powerRetracted = prevRetracted;
    this.powerDeployed = prevDeployed;
    return this;
  };

  Ship.prototype.updateTopSpeed = function() {
    var speeds = calcSpeed(this.unladenMass + this.fuelCapacity, this.speed, this.boost, this.standard[1].c, this.pipSpeed);
    this.topSpeed = speeds['4 Pips'];
    this.topBoost = speeds.boost;
    return this;
  };

  Ship.prototype.updateShieldStrength = function() {
    var sgSlot = this.findInternalByGroup('sg');      // Find Shield Generator slot Index if any
    this.shieldStrength = sgSlot && sgSlot.enabled ? calcShieldStrength(this.hullMass, this.baseShieldStrength, sgSlot.c, this.shieldMultiplier) : 0;
    return this;
  };

  /**
   * Jump Range and total range calculations
   */
  Ship.prototype.updateJumpStats = function() {
    var fsd = this.standard[2].c;   // Frame Shift Drive;
    this.unladenRange = calcJumpRange(this.unladenMass + fsd.maxfuel, fsd, this.fuelCapacity); // Include fuel weight for jump
    this.fullTankRange = calcJumpRange(this.unladenMass + this.fuelCapacity, fsd, this.fuelCapacity); // Full Tanke
    this.ladenRange = calcJumpRange(this.ladenMass, fsd, this.fuelCapacity);
    this.unladenTotalRange = calcTotalRange(this.unladenMass, fsd, this.fuelCapacity);
    this.ladenTotalRange = calcTotalRange(this.unladenMass + this.cargoCapacity, fsd, this.fuelCapacity);
    this.maxJumpCount = Math.ceil(this.fuelCapacity / fsd.maxfuel);
    return this;
  };


  /**
   * Update a slot with a the component if the id is different from the current id for this slot.
   * Has logic handling components that you may only have 1 of (Shield Generator or Refinery).
   *
   * @param {object}  slot            The component slot
   * @param {string}  id              Unique ID for the selected component
   * @param {object}  component       Properties for the selected component
   * @param {boolean} preventUpdate   If true, do not update aggregated stats
   */
  Ship.prototype.use = function(slot, id, component, preventUpdate) {
    if (slot.id != id) { // Selecting a different component
      // Slot is an internal slot, is not being emptied, and the selected component group/type must be of unique
      if (slot.cat == 2 && component && _.includes(['psg', 'sg', 'rf', 'fs'], component.grp)) {
        // Find another internal slot that already has this type/group installed
        var similarSlot = this.findInternalByGroup(component.grp);
        // If another slot has an installed component with of the same type
        if (!preventUpdate && similarSlot && similarSlot !== slot) {
          this.updateStats(similarSlot, null, similarSlot.c);
          similarSlot.id = similarSlot.c = null;  // Empty the slot
          similarSlot.discountedCost = 0;
        }
      }
      var oldComponent = slot.c;
      slot.id = id;
      slot.c = component;
      slot.discountedCost = (component && component.cost) ? component.cost * this.componentCostMultiplier : 0;
      this.updateStats(slot, component, oldComponent, preventUpdate);
    }
    return this;
  };

  /**
   * [useBulkhead description]
   * @param  {[type]} index         [description]
   * @param  {[type]} preventUpdate [description]
   * @return {[type]}               [description]
   */
  Ship.prototype.useBulkhead = function(index, preventUpdate) {
    var oldBulkhead = this.bulkheads.c;
    this.bulkheads.id = index;
    this.bulkheads.c = Components.bulkheads(this.id, index);
    this.bulkheads.discountedCost = this.bulkheads.c.cost * this.componentCostMultiplier;
    this.armourMultiplier = ArmourMultiplier[index];
    this.updateStats(this.bulkheads, this.bulkheads.c, oldBulkhead, preventUpdate);

    return this;
  };

  /**
   * [useStandard description]
   * @param  {[type]} rating [description]
   * @return {[type]}        [description]
   */
  Ship.prototype.useStandard = function(rating) {
    for (var i = this.standard.length - 1; i--; ) { // All except Fuel Tank
      var id = this.standard[i].maxClass + rating;
      this.use(this.standard[i], id, Components.standard(i, id));
    }
    return this;
  };

  /**
   * Use the lightest standard components unless otherwise specified
   * @param  {object} c Component overrides
   */
  Ship.prototype.useLightestStandard = function(c) {
    c = c || {};

    var standard = this.standard,
        pd = c.pd || this.availCS.lightestPowerDist(this.boostEnergy), // Find lightest Power Distributor that can still boost;
        fsd = c.fsd || standard[2].maxClass + 'A',
        ls = c.ls || standard[3].maxClass + 'D',
        s = c.s || standard[5].maxClass + 'D',
        updated;

    this.useBulkhead(0)
        .use(standard[2], fsd, Components.standard(2, fsd))   // FSD
        .use(standard[3], ls, Components.standard(3, ls))     // Life Support
        .use(standard[5], s, Components.standard(5, s))       // Sensors
        .use(standard[4], pd, Components.standard(4, pd));    // Power Distributor

    // Thrusters and Powerplant must be determined after all other components are mounted
    // Loop at least once to determine absolute lightest PD and TH
    do {
      updated = false;
      // Find lightest Thruster that still works for the ship at max mass
      var th = c.th || this.availCS.lightestThruster(this.ladenMass);
      if (th != standard[1].id) {
        this.use(standard[1], th, Components.standard(1, th));
        updated = true;
      }
      // Find lightest Power plant that can power the ship
      var pp = c.pp || this.availCS.lightestPowerPlant(Math.max(this.powerRetracted, this.powerDeployed), c.ppRating);

      if (pp != standard[0].id) {
        this.use(standard[0], pp, Components.standard(0, pp));
        updated = true;
      }
    } while (updated);

    return this;
  };

  Ship.prototype.useUtility = function(group, rating, clobber) {
    var component = Components.findHardpoint(group, 0, rating);
    for (var i = this.hardpoints.length; i--; ) {
      if ((clobber || !this.hardpoints[i].c) && !this.hardpoints[i].maxClass) {
        this.use(this.hardpoints[i], component.id, component);
      }
    }
    return this;
  };

  Ship.prototype.useWeapon = function(group, mount, clobber, missile) {
    var hps = this.hardpoints;
    for (var i = hps.length; i--; ) {
      if (hps[i].maxClass) {
        var size = hps[i].maxClass, component;
        do {
          component = Components.findHardpoint(group, size, null, null, mount, missile);
          if ((clobber || !hps[i].c) && component) {
            this.use(hps[i], component.id, component);
            break;
          }
        } while (!component && (--size > 0));
      }
    }
    return this;
  };

  /**
   * Will change the priority of the specified slot if the new priority is valid
   * @param  {object} slot        The slot to be updated
   * @param  {number} newPriority The new priority to be set
   * @return {boolean}            Returns true if the priority was changed (within range)
   */
  Ship.prototype.changePriority = function(slot, newPriority) {
    if (newPriority >= 0 && newPriority < this.priorityBands.length) {
      var oldPriority = slot.priority;
      slot.priority = newPriority;

      if (slot.enabled) { // Only update power if the slot is enabled
        var usage = powerUsageType(slot, slot.c);
        this.priorityBands[oldPriority][usage] -= slot.c.power;
        this.priorityBands[newPriority][usage] += slot.c.power;
        this.updatePower();
      }
      return true;
    }
    return false;
  };

  return Ship;
}]);
