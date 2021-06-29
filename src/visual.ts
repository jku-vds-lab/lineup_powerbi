/*
 *  Power BI Visual CLI
 *
 *  Copyright (c) Microsoft Corporation
 *  All rights reserved.
 *  MIT License
 *
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the ""Software""), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *
 *  The above copyright notice and this permission notice shall be included in
 *  all copies or substantial portions of the Software.
 *
 *  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 *  THE SOFTWARE.
 */
"use strict";

import "core-js/stable";
import "regenerator-runtime/runtime";
import "./../style/visual.less";
import powerbi from "powerbi-visuals-api";
import extensibility = powerbi.extensibility;

import visual = extensibility.visual;
import VisualConstructorOptions = visual.VisualConstructorOptions;
import VisualUpdateOptions = visual.VisualUpdateOptions;
import IVisual = visual.IVisual;
import IVisualHost = visual.IVisualHost;
import IColorPalette = extensibility.IColorPalette;
import EnumerateVisualObjectInstancesOptions = powerbi.EnumerateVisualObjectInstancesOptions;
import VisualObjectInstance = powerbi.VisualObjectInstance;
import DataView = powerbi.DataView;
import DataViewTable = powerbi.DataViewTable;
import SortDirection = powerbi.SortDirection;
import VisualUpdateType = powerbi.VisualUpdateType;
import VisualObjectInstanceEnumerationObject = powerbi.VisualObjectInstanceEnumerationObject;
import IVisualEventService = powerbi.extensibility.IVisualEventService;

// LineUp.js imports
import { LineUpVisualSettings } from "./settings";
import {
  LocalDataProvider,
  Ranking,
  Column,
  IColumnDesc,
  ISortCriteria,
  INumberFilter,
  NumberColumn,
  EDirtyReason,
} from "lineupjs";
import { LineUp } from "lineupjs";
import { IOrderedGroup } from "lineupjs/src/model/interfaces";
import { IDataProviderDump } from "lineupjs/src/provider/interfaces";


/**
 *
 */
export class Visual implements IVisual {

  /**
  * A reference to the DOM element that will contain the visual
  */
  private readonly target: HTMLElement;


  /**
  * PowerBi color palette
  */
  private readonly colorPalette: IColorPalette;


  /**
  * data provider based on an local array holding the data and rankings
  */
  private provider: LocalDataProvider;


  /**
  * The lineup object - creates the lineUp visual
  */
  private lineup: LineUp;


  /**
  * Holds the lineup and provider settings
  */
  private lineUpVisualSettings: LineUpVisualSettings;


  /**
  * holds the coloring index of the lineup visual columns
  * @default: 0
  */
  private colorIndex = 0;


  /**
  * Holds the actual ranking of the lineUp visual - Catches the events
  */
  private ranking: Ranking;


  /**
  * Holds the actual state of the PowerBi
  */
  private state: Array<any>;


  /**
  * Flag if data is changed
  * @defualt false
  */
  private hasDataChanged: boolean = false;


  /**
  * LineUp - Array to store the sort criterias
  */
  private sortCriteria: ISortCriteria[];


  /**
  * LineUp - Array to stro the group criterias
  * @default: []
  */
  private groupCriteria: Column[] = [];


  /**
  * LineUp - Array to store the group sort criterias
  * @default: []
  */
  private groupSortCriteria: ISortCriteria[] = [];


  /**
  * Holds the actual filterinfo
  * @default: []
  */
  private filterInfo: { filter: INumberFilter, colName: any }[];


  /**
  * allows dump after first loading
  * @default: false
  */
  private criteriaLoadingfinished: boolean = false;


  /**
  * Holds the state of current lineUp to store
  * @default: ""
  */
  private dump: string = "";


  /**
  * PowerBI host, a collection of properties and services that can be used to
  * interact with the visual host
  */
  private visualHost: IVisualHost;


  /**
  * Flag to stop update before saving is finished
  * @default: false
  */
  private stopUpdate: boolean = false;


  /**
  * Rows of lineUp
  */
  private rows: any;


  /**
  * Columns of lineUp
  */
  private cols: any;


  /**
  * Holds old Rows of lineUp
  */
  private oldRows: any;


  /**
  * Holds old Columns of lineUp
  */
  private oldCols: any;


  private lastEvent: string = "";


  /**
  * Creates instance of BarChart. This method is only called once.
  *
  * @constructor
  * @param {VisualConstructorOptions} options - Contains references to the
  *                                             element that will contain the
  *                                             visual and a reference to the
  *                                             host which contains services.
  */
  constructor(options: VisualConstructorOptions) {

    this.visualHost = options.host;
    this.state = new Array<any>();
    this.colorPalette = options.host.colorPalette;
    this.target = options.element;
    // Todo Change this
    this.target.innerHTML = "<div></div>";
    this.lineUpVisualSettings = new LineUpVisualSettings();
    this.hasDataChanged = false;
    this.sortCriteria = new Array<ISortCriteria>();
    this.filterInfo = new Array<any>();
  }


  /**
  * Updates the state of the visual. Every sequential databinding and resize
  * will call update.
  * The first entry in the line up is recorded as VisualUpdateType.Resize
  * in Power BI. Label based matching due to lack of unique identifier
  *
  * @function
  * @param {VisualUpdateOptions} options - Contains references to the size of
  *                                        the container and the dataView which
  *                                        contains all the data the visual had
  *                                        queried.
  */
  update(options: VisualUpdateOptions) {

    let removedColumns: any[] = [];
    const oldSettings = this.lineUpVisualSettings;
    let returnValue:any;
    let providerChanged = false;

    try {
      // parse new settings
      this.lineUpVisualSettings = Visual.parseSettings(
        options && options.dataViews && options.dataViews[0]
      );

      if(!options.dataViews[0].table)
      {
        this.stopUpdate = false;
        return;
      }

      returnValue = this.extract(options.dataViews[0].table!);
      this.rows = returnValue.rows;
      this.cols = returnValue.cols;

      // get old data
      let { oldRows, oldCols } = this.getOldData();
      this.oldRows = oldRows;
      this.oldCols = oldCols;

      // check against old data if new data has really changed?
      this.hasDataChanged = !(this.rows === this.oldRows && this.cols === this.oldCols);
    }
    catch (Error)
    {
      this.stopUpdate = false;
    }

    if(this.stopUpdate && this.lastEvent != "EVENT_HIGHLIGHT_CHANGED")
    {
      this.stopUpdate = false;
      return;
    }

    if(options.dataViews[0].metadata.objects)
    {
      if(this.criteriaLoadingfinished == false)
      {
        this.dump = <string>options.dataViews[0].metadata.objects.dumpObject.dumpProperty;

        if(this.dump != "" && this.dump != "{}")
        {
          this.restoreLineUp(this.dump);
          return;
        }
        else
        {
          this.criteriaLoadingfinished = true;
        }
      }
    }

    // if provider has not been initialized
    if (!this.provider || !this.equalObject(
                            oldSettings.provider,
                            this.lineUpVisualSettings.provider
                          )
    ) {
      // create a new localdata provider from lineup
      this.provider = new LocalDataProvider(
                        this.rows,
                        this.cols,
                        this.lineUpVisualSettings.provider
                      );

      // derive a default ranking
      this.provider.deriveDefault();
      providerChanged = true;
    }
    // if the provider is already present and then the data has changed
    else if (this.hasDataChanged && options.type == VisualUpdateType.Data) {

      // if new cols have been added
      if (this.cols.length >= this.oldCols.length) {
        this.addColumn(this.cols);
      }
      else {
        // otherwise remove the column
        removedColumns = this.removeColumnPBI(this.cols);
      }

      // clear all the columns from the provider
      this.provider.clearColumns();

      this.state.forEach((c: any) => {
        // push all the new columns
        this.provider.pushDesc(c);
      });

      // set data for all the updated rows
      this.provider.setData(this.rows);
      // set a default rank
      this.provider.deriveDefault();
    }

    if (!this.lineup || !this.equalObject(
                          oldSettings.lineup,
                          this.lineUpVisualSettings.lineup
                          )
    ) {
      // initialize lineup
      this.lineup = new LineUp(
        <HTMLElement>this.target.firstElementChild!,
        this.provider,
        this.lineUpVisualSettings.lineup
      );
      this.ranking = this.lineup.data.getLastRanking();
      this.state.length = 0;
      this.ranking.children.slice(3, this.ranking.children.length)
                           .forEach((c: Column) => this.state.push(c.desc));
    }
    else if (providerChanged) {
      // set the data provider if lineup is already initialized
      this.lineup.setDataProvider(this.provider);
    }
    else {
      this.lineup.update();
    }

    if (this.lineup) {
      // get lineup ranking
      this.ranking = this.lineup.data.getLastRanking();
      // handle all the event listeners
      this.handleEventListeners(this.rows, this.cols);
    }

    if (this.groupCriteria.length > 0) {
      this.handleGruopCriteria(removedColumns);
    }

    if (this.filterInfo.length > 0) {
      this.handleFilterChange(removedColumns);
    }

    this.state.length = 0;
    this.ranking.children.slice(3, this.ranking.children.length)
                         .forEach((c: Column) => this.state.push(c.desc));
  }


  /**
  * stes event listeners for the lineUp events
  *
  * @function
  * @param { any[] } rows
  * @param { any[] } cols
  */
  private handleEventListeners(rows: any[], cols: any[]) {

    let this_ = this;
    document.getElementById("sandbox-host")
            .addEventListener("click", (e:Event) => {
      this_.storeLineUp("Click");
    });

    this.ranking.on(Ranking.EVENT_WIDTH_CHANGED, (
      previous: number,
      current: number
    ) => {
      this.storeLineUp("EVENT_WIDTH_CHANGED");
    });

    this.ranking.on(Ranking.EVENT_FILTER_CHANGED, (
      previous: INumberFilter,
      current: INumberFilter
    ) => {
      this.ranking.children.forEach((c: Column) => {
        if (c.isFiltered()) {
          this.filterInfo.push({ filter: current, colName: c.label });
        }
      });
      this.storeLineUp("EVENT_FILTER_CHANGED");
    });

    this.ranking.on(Ranking.EVENT_LABEL_CHANGED, (
      previous: string,
      current: string
    ) => {
      this.storeLineUp("EVENT_LABEL_CHANGED");
    });

    //Handled already within group criteria
    this.ranking.on(Ranking.EVENT_GROUPS_CHANGED, (
      previous: string,
      current: string
    ) => {
      this.storeLineUp("EVENT_GROUPS_CHANGED");
    });

    this.ranking.on(Ranking.EVENT_ADD_COLUMN, (
      previous: string,
      current: string
    ) => {
      this.state.length = 0;
      this.ranking.children.slice(3, this.ranking.children.length)
                           .forEach((c: Column) => this.state.push(c.desc));
      this.storeLineUp("EVENT_ADD_COLUMN");
    });

    // Remove the column from state and update it. and also remove it from cols?
    this.ranking.on(Ranking.EVENT_REMOVE_COLUMN, (
      col: Column,
      index: number
    ) => {
      // Remove the column from state and update it. and also remove it from cols?
      this.state.length = 0;
      this.ranking.children.slice(3, this.ranking.children.length)
                           .forEach((c: Column) => this.state.push(c.desc));
      this.storeLineUp("EVENT_REMOVE_COLUMN");
    });

    this.ranking.on(Ranking.EVENT_GROUP_CRITERIA_CHANGED, (
      previous: Column[],
      current: Column[]
    ) => {

      let groupedColumn: Column;

      if (this.groupCriteria.length > 0) {
        this.groupCriteria.forEach((g: Column) => {
          current.forEach((c: Column) => {
            groupedColumn = c;
            if (g.label == c.label) {
              groupedColumn = null;
              this.storeLineUp("EVENT_GROUP_CRITERIA_CHANGED");
              return;
            }
          });

          if (groupedColumn) {
            this.groupCriteria.push(groupedColumn);
          }
        });
      }
      else {
        current.forEach((c: Column) => {
          this.groupCriteria.push(c);
        });
      }

      this.storeLineUp("EVENT_GROUP_CRITERIA_CHANGED");
    });

    this.ranking.on(Ranking.EVENT_MOVE_COLUMN, (
      col: Column,
      index: number,
      oldIndex: number
    ) => {
      this.state.length = 0;
      this.ranking.children.slice(3, this.ranking.children.length)
                           .forEach((c: Column) => this.state.push(c.desc));
      this.storeLineUp("EVENT_MOVE_COLUMN");
    });

    this.ranking.on(Ranking.EVENT_DIRTY, (
      previous: string,
      current: string
    ) => {
      //this.storeLineUp("EVENT_DIRTY");
    });

    this.ranking.on(Ranking.EVENT_DIRTY_HEADER, (
      previous: string,
      current: string
    ) => {
      //this.storeLineUp("EVENT_DIRTY_HEADER");
    });

    this.ranking.on(Ranking.EVENT_DIRTY_VALUES, (
      previous: string,
      current: string
    ) => {
      //this.storeLineUp("EVENT_DIRTY_VALUES");
    });

    this.ranking.on(Ranking.EVENT_DIRTY_CACHES, (
      previous: string,
      current: string
    ) => {
      //this.storeLineUp("EVENT_DIRTY_CACHES");
    });

    this.ranking.on(Ranking.EVENT_GROUP_SORT_CRITERIA_CHANGED, (
      previous: ISortCriteria[],
      current: ISortCriteria[]
    ) => {
      let gSortCriteria: ISortCriteria;

      if (this.groupSortCriteria.length > 0) {
        this.groupSortCriteria.forEach((g: ISortCriteria) => {
          current.forEach((c: ISortCriteria) => {
            gSortCriteria = c;
            if (g.col.label == c.col.label) {
              gSortCriteria = null;
              this.storeLineUp("EVENT_GROUP_SORT_CRITERIA_CHANGED");
              return;
            }
          });

          if (gSortCriteria) {
            this.groupSortCriteria.push(gSortCriteria);
          }
        });
      }
      else {
        current.forEach((c: ISortCriteria) => {
          this.groupSortCriteria.push(c);
        });
      }
      this.storeLineUp("EVENT_GROUP_SORT_CRITERIA_CHANGED");
    });

    this.ranking.on(Ranking.EVENT_COLUMN_VISIBILITY_CHANGED, (
      previous: string,
      current: string
    ) => {
      this.storeLineUp("EVENT_COLUMN_VISIBILITY_CHANGED");
    });

    this.ranking.on(Ranking.EVENT_SORT_CRITERIA_CHANGED, (
      previous: number,
      current: number
    ) => {
      //this.sortCriteria = this.ranking.getSortCriteria();
      this.storeLineUp("EVENT_SORT_CRITERIA_CHANGED");
    });

    this.ranking.on(Ranking.EVENT_DIRTY_ORDER, (
      previous: string,
      current: string
    ) => {
      //this.storeLineUp("EVENT_DIRTY_ORDER");
    });

    this.ranking.on(Ranking.EVENT_ORDER_CHANGED, (
      previous: string,
      current: string
    ) => {
      //this.storeLineUp("EVENT_ORDER_CHANGED");
    });

    this.ranking.on(Ranking.EVENT_GROUPS_CHANGED, (
      previous: string,
      current: string
    ) => {
      //this.storeLineUp("EVENT_GROUPS_CHANGED");
    });

    this.lineup.on(LineUp.EVENT_SELECTION_CHANGED, () => {
      this.storeLineUp("EVENT_SELECTION_CHANGED");
    });

    this.lineup.on(LineUp.EVENT_DIALOG_OPENED, () => {
      this.storeLineUp("EVENT_DIALOG_OPENED");
    });

    this.lineup.on(LineUp.EVENT_DIALOG_CLOSED, () => {
      this.storeLineUp("EVENT_DIALOG_CLOSED");
    });

    this.lineup.on(LineUp.EVENT_HIGHLIGHT_CHANGED, () => {
      this.storeLineUp("EVENT_HIGHLIGHT_CHANGED");
    });

    /*if (this.hasDataChanged) {
      this.ranking.setSortCriteria(this.sortCriteria);

      let dirtyReason: EDirtyReason[];
      this.provider.sort(this.ranking, dirtyReason);

      if (this.filterInfo.length > 0) {
        this.ranking.children.forEach((c: Column) => {
          this.filterInfo.forEach((f: any) => {
            if (c.desc.type == "number" && c.label == f.colName) {
                (<NumberColumn>c).setFilter(f.filter);
            }
          })
        });
      }
    }*/
  }


  /**
  * Adds the given column to the visual
  *
  * @param { any[] } cols - actual columns of the visuals
  */
  private addColumn(cols: any[]) {
    let flag = true;

    cols.forEach((c: any) => {
      flag = true;
      this.state.forEach((s: any) => {
        // compare label due to lack of missing key identifier
        if (c.label === s.label) {
          flag = false;
        }
      });
      if (flag) {
        // push the column in the current state of the visual, if the
        // column is new
        this.state.push(c);
      }
    });
  }


  /**
  * Sets the changed groupCriteria
  *
  * @param { any[] } removedColumns - Array of removed columns
  */
  private handleGruopCriteria(removedColumns: any[]) {
    let indexToBeRemoved = -1;

    this.groupCriteria.forEach((g: any) => {
      removedColumns.forEach((c: any) => {
        if (c.label == g.label) {
          indexToBeRemoved = this.groupCriteria.indexOf(g);
        }
      });
    });

    if (indexToBeRemoved >= 0) {
      this.groupCriteria.splice(indexToBeRemoved, 1);
    }

    if (this.groupCriteria.length > 0) {
      this.ranking.setGroupCriteria(this.groupCriteria);
      this.ranking.setGroupSortCriteria(this.groupSortCriteria);
    }
  }


  /**
  * Sets the filter changes
  *
  * @param { any[] } removedColumns - Array of removed columns
  */
  private handleFilterChange(removedColumns: any[]) {
    let indexToBeRemoved = -1;
    removedColumns.forEach((c: Column) => {
      for (let i = 0; i < this.filterInfo.length; i++) {
        if (this.filterInfo[i].colName == c.label) {
          indexToBeRemoved = i;
        }
      }
    });

    if (indexToBeRemoved >= 0) {
      this.filterInfo.splice(indexToBeRemoved, 1);
    }

    if (this.filterInfo.length > 0) {
      this.ranking.children.forEach((c: Column) => {
        this.filterInfo.forEach((f: any) => {
          if (c.desc.type == "number" && c.label == f.colName) {
            (<NumberColumn>c).setFilter(f.filter);
          }
        });
      });
    }
  }


  /**
  * Stores the current lineUp stat in localStorage
  *
  * @function
  * @param -
  */
  private storeLineUp(event:string) {

    this.stopUpdate = true;

    // create LineUp dump and convert it to string
    let dump: string = "";
    dump = JSON.stringify(this.lineup.dump());
    this.dump = dump;

    this.lineUpVisualSettings.dump.dump = this.dump;

    this.persist();
  }


  /**
  * Updates the last saved state of lineUp - called only once at start
  *
  * @function
  * @param { string } criteria - state value from the PowerBi local storage
  */
  private restoreLineUp(data: string) {

    // If no criteria return
    if (
        false && typeof data == "undefined" ||
        data == "undefined" ||
        data == "" ||
        data == "{}"
    ) {
      this.criteriaLoadingfinished = true;
      return;
    }

    // Create dump for restore
    let dump: IDataProviderDump = JSON.parse(data) as IDataProviderDump;

    // set dump to the provider and update lineup
    try {

      if (!this.provider) {

        // create a new localdata provider from lineup
        this.provider = new LocalDataProvider(this.rows, this.cols);

        // derive a default ranking
        this.provider.deriveDefault();
        //providerChanged = true;
      }

      if(!this.lineup)
      {
        this.lineup = new LineUp(
          <HTMLElement>this.target.firstElementChild!,
          this.provider
        );
      }

      this.lineup.setDataProvider(this.provider, dump);

      // recreate ranking and set event listeners again
      this.ranking = this.lineup.data.getLastRanking();
      this.handleEventListeners(this.rows, this.cols);
    }
    catch (Error) {
      console.log("Error Restoring last state - Error: " + Error.message);
    }

    // Enable saving new state
    this.criteriaLoadingfinished = true;
  }


  /**
  * Removes a column from the lineup visual
  *
  * @function
  * @param { any[] } cols - columns of actual visual
  */
  private removeColumnPBI(cols: any[]) {

    let removedColumns: any[] = [];

    this.state.forEach((s: any) => {
      s.column = -1;
      cols.forEach((c: any) => {
        if (c.label == s.label) {
          s.column = c.column;
        }
      });
    });

    let indexToBeRemoved = -1;

    for (let i = 0; i < this.state.length; i++) {
      if (this.state[i].column == -1) {
        indexToBeRemoved = i;
        break;
      }
    }

    if (indexToBeRemoved >= 0) {
      removedColumns = this.state.splice(indexToBeRemoved, 1);
    }

    return removedColumns;
  }


  /**
  * Returns actual rows and columns of the PowerBi
  *
  * @function
  * @param
  */
  private getOldData() {

    let rows = null;
    let cols = new Array<any>();

    if (this.provider != null) {
      rows = this.provider.data;
      cols = this.provider.getColumns();
    }

    return { oldRows: rows, oldCols: cols };
  }


  /**
  * Extracts rows and columns of the PowerBi table
  *
  * @function
  * @param { DataViewTable } table - Actual PowerBi data table
  */
  private extract(table: DataViewTable) {

    let rows: any;
    try {
      rows = table.rows || [];
    }
    catch(Error)
    {
      console.log("Error extracting data from DataViewTable" + Error.message);
    }

    let colors = this.colorPalette;
    const cols = table.columns.map((d) => {
      const c: any = {
        type: "string",
        label: d.displayName,
        column: d.index,
      };

      // row identifer are always strings
      if (!d.type || d.roles!.row) {
        c.type = "string";
      }
      else if (d.type.bool) {
        c.type = "boolean";
      }
      else if (d.type.integer || d.type.numeric) {
        c.type = "number";
        c.colorMapping = colors.getColor(String(this.colorIndex)).value;
        this.colorIndex++;

        const vs = rows.map((r) => <number>r[d.index!]);
        c.domain = [Math.min(...vs), Math.max(...vs)];
      }
      else if (d.type.dateTime) {
        c.type = "date";
      }
      else if (d.type.enumeration) {
        c.type = "categorical";
        c.categories = d.type.enumeration.members().map((cat) => {
          return {
            label: cat.displayName,
            name: cat.value,
          };
        });
      }

      return c;
    });

    const sort = table.columns
      .filter((d) => d.sort)
      .sort((a, b) => a.sortOrder! - b.sortOrder!)
      .map((d) => ({
        asc: d.sort === SortDirection.Ascending,
        label: d.displayName,
      }));


    return { rows, cols, sort };
  }


  /**
   * Checks if two given objects are the same - returns true if the objects are
   * the same.
   *
   * @function
   * @param { any } a
   * @param { any } b
   */
  private equalObject(a: any, b: any) {

    if (a === b) {
      return true;
    }

    if (!a || !b) {
      return false;
    }

    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);

    if (aKeys.length !== bKeys.length) {
      return false;
    }

    return aKeys.every((k) => a[k] === b[k]);
  }


  /**
   * Parses PowerBi settings to LineUp settings and returns them
   *
   * @function
   * @param { DataView } dataView - Represents views of a data set.
   */
  private static parseSettings(dataView: DataView): LineUpVisualSettings {
    return <LineUpVisualSettings>LineUpVisualSettings.parse(dataView);
  }


  /**
   * Destroy runs when the visual is removed. Any cleanup that the visual needs
   * to do should be done here.
   *
   * @function
   */
  public destroy() {

  }


  /**
  * This function gets called for each of the objects defined in the
  * capabilities files and allows you to select which of the
  * objects and properties you want to expose to the users in
  * the property pane.
  */
  public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstance[] | VisualObjectInstanceEnumerationObject {

    const instanceEnumeration: powerbi.VisualObjectInstanceEnumeration = LineUpVisualSettings.enumerateObjectInstances(this.lineUpVisualSettings || LineUpVisualSettings.getDefault(), options);

    switch (options.objectName) {
      case "dumpObject" :
        // ignore rendering general settings (it include only hidden properties)
        return;
    }

    return instanceEnumeration || [];
  }


  /**
  * Saves the dump to the dumpObject at capabilities.json file for the next
  * reload or page change
  *
  * @function
  * @param
  */
  private persist() {

    let objects: powerbi.VisualObjectInstancesToPersist = {
      merge: [
        <VisualObjectInstance>{
          objectName: "dumpObject",
          selector: undefined,
          properties: {
            "dumpProperty": this.dump
          }
        }]
    };

    this.visualHost.persistProperties(objects);
  }
}


