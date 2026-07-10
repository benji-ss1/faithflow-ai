# OpenLP / OpenLyrics fixtures

The `.osz` file is a ZIP wrapping OpenLyrics XML. We build the ZIP in
memory in `parsers.test.ts` rather than committing a binary blob. See
`openlyrics.xml` for the inner XML shape that the test packs into the
zip.

The inner XML uses the OpenLyrics 2009 namespace:

    <song xmlns="http://openlyrics.info/namespace/2009/song" version="0.9">
      <properties>
        <titles><title>Song Name</title></titles>
        <authors><author>Author Name</author></authors>
      </properties>
      <lyrics>
        <verse name="v1"><lines>Line one<br/>Line two</lines></verse>
      </lyrics>
    </song>
