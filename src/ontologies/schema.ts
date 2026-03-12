import {NodeReferenceValue} from '../utils/NodeReference.js';
import {Prefix} from '../utils/Prefix.js';

const base = 'https://schema.org/';
export const ns = (term: string): NodeReferenceValue => ({id: base + term});

export const _ontologyResource = ns('');
Prefix.add('schema', base);

const Person = ns('Person');
const Employee = ns('Employee');
const Pet = ns('Pet');
const Dog = ns('Dog');
const name = ns('name');
const knows = ns('knows');
const employeeId = ns('employeeId');

export const schema = {
  _ontologyResource,
  Person,
  Employee,
  Pet,
  Dog,
  name,
  knows,
  employeeId,
};
