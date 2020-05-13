import { LevelGraph } from 'level-ts'

declare type TripleInp = string | number;
interface ITripleBase {
  subject: TripleInp;
  predicate: TripleInp;
  object: TripleInp;
}
interface ITriple<Predicates extends TripleInp> extends ITripleBase {
  predicate: Predicates;
  [key: string]: any;
}

export class StoreChild {
  constructor (private db: LevelGraph, subject: string) {
  }
}

export class Store {
  constructor (private db: LevelGraph) {
  }
}
