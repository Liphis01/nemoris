import Toolbar from "./Toolbar";
import QuestionTable from "./QuestionTable";
import { containerStyle } from "./styles";

export default function Manage(props) {
  const {
    setMode,
    filteredQuestions,
    search,
    setSearch,
    filterTheme,
    setFilterTheme,
    filterDue,
    setFilterDue,
  } = props;

  return (
    <div style={containerStyle}>
      
      <Toolbar
        setMode={setMode}
        search={search}
        setSearch={setSearch}
        filterTheme={filterTheme}
        setFilterTheme={setFilterTheme}
        filterDue={filterDue}
        setFilterDue={setFilterDue}
        count={filteredQuestions.length}
      />

      <QuestionTable {...props} />
    </div>
  );
}